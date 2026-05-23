require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const multer = require('multer');
const pdf = require('pdf-parse');
const xlsx = require('xlsx');

global.WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

// Set up Supabase admin client (bypasses RLS so the AI engine can write results)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Requires Service Role Key
);

// Set up Nvidia OpenAI Client
const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

// Helper: robustly parse JSON from LLM output by removing markdown backticks, conversational wrapping, handling loose JSON (single quotes, trailing commas), stripping comments, and cleaning formatted numbers
function parseRobustJSON(text) {
  text = text.trim();
  
  // Remove markdown code fences if present
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n/, '');
    text = text.replace(/\n```$/, '');
    text = text.trim();
  }
  
  // Clean numbers with commas in unquoted values (e.g. : 87,000 -> : 87000)
  text = text.replace(/(:\s*)(\d{1,3}(?:,\d{3})+(\.\d+)?)/g, (match, p1, p2) => {
    return p1 + p2.replace(/,/g, '');
  });
  
  const startBrace = text.indexOf('{');
  const startBracket = text.indexOf('[');
  
  let startIdx = -1;
  let endIdx = -1;
  
  if (startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) {
    startIdx = startBrace;
    endIdx = text.lastIndexOf('}');
  } else if (startBracket !== -1) {
    startIdx = startBracket;
    endIdx = text.lastIndexOf(']');
  }
  
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const jsonStr = text.substring(startIdx, endIdx + 1);
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      try {
        // Strip out single-line and multi-line comments
        let cleanJS = jsonStr.replace(/\/\/.*?\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
        return Function(`return (${cleanJS});`)();
      } catch (innerErr) {
        try {
          return eval(`(${jsonStr})`);
        } catch (evalErr) {
          throw e; // Throw original JSON.parse error if both fail
        }
      }
    }
  }
  
  try {
    return JSON.parse(text);
  } catch (e) {
    try {
      let cleanText = text.replace(/\/\/.*?\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
      return Function(`return (${cleanText});`)();
    } catch (innerErr) {
      try {
        return eval(`(${text})`);
      } catch (evalErr) {
        throw e;
      }
    }
  }
}


// Helper: convert an array of objects into a clean markdown table string
function toMarkdownTable(rows) {
  if (!rows || rows.length === 0) return '(empty)';
  const headers = Object.keys(rows[0]);
  const divider = headers.map(h => '-'.repeat(Math.max(h.length, 6))).join(' | ');
  const headerRow = headers.join(' | ');
  const dataRows = rows.map(r => headers.map(h => String(r[h] ?? '')).join(' | '));
  return [headerRow, divider, ...dataRows].join('\n');
}

// Helper: Parse PDF page by page using pdf-parse custom pagerender
async function parsePDFPages(buffer) {
  let pageCount = 0;
  const options = {
    pagerender: function (pageData) {
      return pageData.getTextContent().then(function (textContent) {
        pageCount++;
        let lastY, text = '';
        for (let item of textContent.items) {
          if (lastY == item.transform[5] || !lastY) {
            text += item.str + ' ';
          } else {
            text += '\n' + item.str + ' ';
          }
          lastY = item.transform[5];
        }
        return `\n--- PAGE_START_${pageCount} ---\n` + text + `\n--- PAGE_END_${pageCount} ---\n`;
      });
    }
  };

  const data = await pdf(buffer, options);
  const pages = [];
  for (let i = 1; i <= pageCount; i++) {
    const startTag = `--- PAGE_START_${i} ---`;
    const endTag = `--- PAGE_END_${i} ---`;
    const startIdx = data.text.indexOf(startTag);
    const endIdx = data.text.indexOf(endTag);
    
    if (startIdx !== -1 && endIdx !== -1) {
      const pageText = data.text.substring(startIdx + startTag.length, endIdx).trim();
      pages.push({
        nodeType: 'page',
        identifier: `Page ${i}`,
        rawText: pageText,
        textPreview: pageText.substring(0, 1500)
      });
    }
  }
  return pages;
}

// Helper: Parse Excel worksheets into nodes
async function parseExcelSheets(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const sheets = [];
  for (const sName of wb.SheetNames) {
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[sName]);
    if (rows.length > 0) {
      const tableText = toMarkdownTable(rows.slice(0, 80));
      sheets.push({
        nodeType: 'sheet',
        identifier: `Sheet: ${sName}`,
        rawText: tableText,
        textPreview: tableText.substring(0, 1500),
        rowsCount: rows.length
      });
    }
  }
  return sheets;
}

// Helper: Generate metadata for a page/sheet node using Llama 3.1 8B
async function generateNodeMetadata(node) {
  if (node.metadata) return node.metadata;
  
  try {
    const prompt = `You are a professional financial auditing assistant. Your job is to analyze a single page or sheet from a supporting document and extract key indexing metadata in a clean JSON format.

FILE NAME: ${node.fileName}
SECTION: ${node.identifier}
CONTENT PREVIEW:
${node.textPreview}

Please extract the following fields:
1. "document_type": e.g. "Invoice", "Receipt", "Purchase Order", "Delivery Note", "Bank Statement", "Ledger", or "Unknown"
2. "vendor_name": The exact name of the vendor, party, supplier, client, or bank. (e.g. "Reliance Industries")
3. "total_amount": The primary total, grand total, or invoice amount as a clean number (e.g. 150000.00). 0 if not found.
4. "invoice_number": The invoice number, reference number, or bill ID. null if not found.
5. "date": The date on the document. null if not found.
6. "summary": A brief 1-sentence description of what this section contains.

Return ONLY a raw JSON object with these exact keys. No conversational prefixes, no markdown formatting:
{
  "document_type": "...",
  "vendor_name": "...",
  "total_amount": 0,
  "invoice_number": "...",
  "date": "...",
  "summary": "..."
}`;

    const response = await openai.chat.completions.create({
      model: "meta/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.05,
      max_tokens: 500,
    });
    
    const text = response.choices[0].message.content.trim();
    return parseRobustJSON(text);
  } catch (err) {
    console.error(`Failed to generate metadata for ${node.fileName} (${node.identifier}):`, err);
    return {
      document_type: 'Unknown',
      vendor_name: node.fileName.replace(/\\.[^/.]+$/, ""),
      total_amount: 0,
      invoice_number: null,
      date: null,
      summary: `Supporting document section: ${node.identifier}`
    };
  }
}


// Endpoint to process a batch
app.post('/api/process-batch', async (req, res) => {
  try {
    const { excelPath, supportPaths, clientId, processingMode, columnMapping } = req.body;
    
    if (!excelPath || !clientId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // 1. Create Batch Record
    const { data: batchData, error: batchError } = await supabase
      .from('batches')
      .insert({
        user_id: clientId,
        filename: excelPath.split('_').slice(1).join('_'), // Strip timestamp
        file_url: excelPath,
        status: 'processing'
      })
      .select('id')
      .single();

    if (batchError) throw batchError;
    const dbBatchId = batchData.id;
    
    // Respond immediately
    res.json({ message: 'Processing started', status: 'processing', batchId: dbBatchId });

    // Background Processing
    setTimeout(async () => {
      try {
        console.log(`Starting AI PageIndex RAG processing for batch ${dbBatchId}...`);
        
        // Determine AI model to use
        const isTurbo = processingMode === '8b';
        console.log(`Auditor Processing Mode: ${processingMode} (Turbo: ${isTurbo})`);

        // 2. Download and Parse Transaction Excel Dump
        const { data: excelBlob, error: downloadError } = await supabase.storage.from('uploads').download(excelPath);
        if (downloadError) throw downloadError;

        const arrayBuffer = await excelBlob.arrayBuffer();
        const workbook = xlsx.read(arrayBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const allRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        console.log(`Extracted ${allRows.length} rows from transaction Excel dump.`);

        if (allRows.length === 0) {
          throw new Error('No transactions found in the Excel dump. Please check the file format.');
        }

        const allHeaders = Object.keys(allRows[0]);
        const sampleRow = allRows[0];
        const txnRows = allRows.slice(0, 25); // Audit up to 25 transactions as defined in limits
        console.log(`Transaction Excel columns detected: ${allHeaders.join(', ')}`);

        // 3. Download and Parse Supporting Documents to build PageTreeIndex
        console.log(`Building PageTreeIndex for ${supportPaths.length} supporting documents...`);
        let supportNodes = [];

        for (const path of supportPaths) {
          const { data: supportBlob } = await supabase.storage.from('uploads').download(path);
          if (!supportBlob) continue;
          
          const fileName = path.split('/').pop().split('_').slice(1).join('_') || path.split('/').pop();
          const ext = path.split('.').pop().toLowerCase();
          const buf = Buffer.from(await supportBlob.arrayBuffer());
          
          if (['xlsx','csv','xls','xlsm','xlsb'].includes(ext)) {
            const sheets = await parseExcelSheets(buf);
            sheets.forEach(s => {
              s.fileName = fileName;
              supportNodes.push(s);
            });
          } else if (ext === 'pdf') {
            try {
              const pages = await parsePDFPages(buf);
              pages.forEach(p => {
                p.fileName = fileName;
                supportNodes.push(p);
              });
            } catch (pdfErr) {
              console.error(`Failed to parse PDF ${fileName}:`, pdfErr);
              supportNodes.push({
                nodeType: 'pdf_error',
                identifier: 'PDF Read Error',
                fileName,
                rawText: `[Error reading PDF file: ${fileName}]`,
                textPreview: `PDF file: ${fileName} (failed to parse)`,
                metadata: {
                  document_type: 'Unknown (Error PDF)',
                  vendor_name: fileName.replace(/\.[^/.]+$/, ""),
                  total_amount: 0,
                  invoice_number: null,
                  date: null,
                  summary: `Unparseable PDF: ${fileName}`
                }
              });
            }
          } else {
            // Image or other unsupported files - Fallback to filename metadata extraction
            supportNodes.push({
              nodeType: 'image',
              identifier: 'Image Document',
              fileName,
              rawText: `[Image document: ${fileName}]`,
              textPreview: `Image file: ${fileName}`,
              metadata: {
                document_type: 'Unknown (Image)',
                vendor_name: fileName.replace(/\.[^/.]+$/, "").split(/[_\-]/).join(' '),
                total_amount: 0,
                invoice_number: null,
                date: null,
                summary: `Image upload: ${fileName}`
              }
            });
          }
        }

        // Generate metadata summaries for all nodes to compile the PageTreeIndex
        console.log(`Indexing ${supportNodes.length} document pages/sheets using Llama 3.1 8B...`);
        for (let i = 0; i < supportNodes.length; i += 5) {
          const chunk = supportNodes.slice(i, i + 5);
          await Promise.all(chunk.map(async (node) => {
            node.metadata = await generateNodeMetadata(node);
          }));
        }

        const pageTreeIndex = supportNodes.map((node, index) => ({
          indexId: index,
          fileName: node.fileName,
          section: node.identifier,
          documentType: node.metadata.document_type,
          vendorName: node.metadata.vendor_name,
          totalAmount: node.metadata.total_amount,
          invoiceNumber: node.metadata.invoice_number,
          date: node.metadata.date,
          summary: node.metadata.summary
        }));

        console.log(`PageTreeIndex fully compiled with ${pageTreeIndex.length} nodes:`, JSON.stringify(pageTreeIndex, null, 2));

        // 4. Navigation & Matching Loop
        const finalVouchingResults = [];

        for (let idx = 0; idx < txnRows.length; idx++) {
          const txn = txnRows[idx];
          console.log(`[${idx+1}/${txnRows.length}] Auditing transaction: ID = ${txn[allHeaders[0]] || 'N/A'}, Vendor = ${txn[allHeaders[1]] || 'N/A'}`);

          // Step 1: Navigating the PageTreeIndex to find the correct node(s)
          let candidateIndices = [];
          try {
            const navigationPrompt = `You are a professional financial auditor navigation engine. Given a specific transaction and a structured index of all supporting documents (PageTreeIndex), identify which pages or sheets are highly likely to contain the supporting evidence (such as invoices, receipts, or purchase entries) for this transaction.

TRANSACTION TO AUDIT:
${JSON.stringify(txn, null, 2)}

SUPPORTING DOCUMENTS INDEX (PageTreeIndex):
${JSON.stringify(pageTreeIndex, null, 2)}

INSTRUCTIONS:
1. Search the PageTreeIndex for nodes where the vendor name matches (fuzzy, check for spelling variations or parent entities).
2. Look for amounts that match or are close to the transaction amount.
3. Look for matching dates or references.
4. Output a list of "indexId" numbers of the candidate pages/sheets. If no pages are relevant, return an empty array.
5. Return ONLY a raw JSON array of integers representing the indexIds. Do not add any explanation or markdown tags.
Example output: [0, 2]`;

            const navResponse = await openai.chat.completions.create({
              model: "meta/llama-3.1-8b-instruct",
              messages: [{ role: "user", content: navigationPrompt }],
              temperature: 0.05,
              max_tokens: 100,
            });

            const navText = navResponse.choices[0].message.content.trim();
            candidateIndices = parseRobustJSON(navText);
            if (!Array.isArray(candidateIndices)) candidateIndices = [];
          } catch (navErr) {
            console.error("Navigation error:", navErr);
            // Fallback: search all nodes
            candidateIndices = pageTreeIndex.map(p => p.indexId);
          }

          console.log(`Selected candidate index IDs:`, candidateIndices);

          if (candidateIndices.length === 0) {
            const keys = Object.keys(txn);
            const txnIdKey = keys.find(k => k.toLowerCase().includes('id') || k.toLowerCase().includes('ref') || k.toLowerCase().includes('no')) || keys[0];
            const amountKey = keys.find(k => k.toLowerCase().includes('amt') || k.toLowerCase().includes('amount') || k.toLowerCase().includes('val') || k.toLowerCase().includes('price')) || keys[keys.length - 1];
            
            finalVouchingResults.push({
              txn_id: String(txn[txnIdKey] ?? 'UNKNOWN'),
              vendor: txn[allHeaders[1]] || 'UNKNOWN',
              amount_dump: Number(txn[amountKey]) || 0,
              amount_doc: 0,
              confidence: 0.0,
              status: 'flagged',
              auditor_notes: `Flagged: No matching supporting documents could be located in the uploaded files index.`
            });
            continue;
          }

          // Step 2: Fetch detailed raw contents for candidate nodes
          const candidateDocsContent = candidateIndices.map(id => {
            const node = supportNodes[id];
            return `--- File: ${node.fileName} | ${node.identifier} ---\n${node.rawText}`;
          }).join('\n\n');

          // Step 3: Column-by-column reconciliation & audit matching
          try {
            const reconciliationPrompt = `You are an expert financial auditor performing a detailed vouching audit. Your task is to reconcile a single transaction row against the selected detailed contents of the supporting documents.

TRANSACTION DETAILS:
${JSON.stringify(txn, null, 2)}

SUPPORTING DOCUMENT DETAILS:
${candidateDocsContent}

AUDITING INSTRUCTIONS:
Perform a strict column-by-column reconciliation:
1. **Vendor Name**: Check if the vendor name in the transaction matches the vendor name in the supporting documents (use fuzzy matching, allow for abbreviations, case differences, etc.).
2. **Amount**: Check if the amount in the transaction matches any amount in the supporting documents exactly or closely.
3. **Date**: Verify if the transaction date corresponds to the document date.
4. **Reference Numbers**: Reconcile invoice numbers or references.

DETERMINE STATUS & CONFIDENCE:
- If both the vendor name and amount match exactly/closely, and reference/date correlates → status: "matched", confidence: 0.95 to 1.0.
- If the vendor matches but the amount differs, or if there is a partial mismatch → status: "mismatched", confidence: 0.5 to 0.8. Note both amounts.
- If the details are conflicting or do not substantiate the transaction → status: "flagged", confidence: 0.0 to 0.4.

Return ONLY a raw JSON object matching the following structure. No markdown formatting, no conversational text.
{
  "vendor": "<inferred vendor name>",
  "amount_doc": <numeric amount from the support document, or 0 if not found>,
  "confidence": <confidence score 0.0 to 1.0>,
  "status": "matched" | "mismatched" | "flagged",
  "auditor_notes": "<highly detailed, professional audit note explaining the exact comparison of vendor, amount, date, and references. YOU MUST CITE the exact file name and page/sheet number where the evidence was found.>"
}`;

            const modelName = isTurbo ? "meta/llama-3.1-8b-instruct" : "meta/llama-3.3-70b-instruct";
            const auditResponse = await openai.chat.completions.create({
              model: modelName,
              messages: [{ role: "user", content: reconciliationPrompt }],
              temperature: 0.05,
              max_tokens: 800,
            });

            const auditText = auditResponse.choices[0].message.content.trim();
            const auditResult = parseRobustJSON(auditText);

            const keys = Object.keys(txn);
            const txnIdKey = keys.find(k => k.toLowerCase().includes('id') || k.toLowerCase().includes('ref') || k.toLowerCase().includes('no')) || keys[0];
            const amountKey = keys.find(k => k.toLowerCase().includes('amt') || k.toLowerCase().includes('amount') || k.toLowerCase().includes('val') || k.toLowerCase().includes('price')) || keys[keys.length - 1];

            finalVouchingResults.push({
              txn_id: String(txn[txnIdKey] ?? 'UNKNOWN'),
              vendor: auditResult.vendor || txn[allHeaders[1]] || 'UNKNOWN',
              amount_dump: Number(txn[amountKey]) || 0,
              amount_doc: Number(auditResult.amount_doc) || 0,
              confidence: Number(auditResult.confidence) || 0,
              status: auditResult.status || 'flagged',
              auditor_notes: auditResult.auditor_notes || 'Processed by PageIndex RAG engine.'
            });

          } catch (auditErr) {
            console.error(`Audit error for transaction:`, auditErr);
            const keys = Object.keys(txn);
            const txnIdKey = keys.find(k => k.toLowerCase().includes('id') || k.toLowerCase().includes('ref') || k.toLowerCase().includes('no')) || keys[0];
            const amountKey = keys.find(k => k.toLowerCase().includes('amt') || k.toLowerCase().includes('amount') || k.toLowerCase().includes('val') || k.toLowerCase().includes('price')) || keys[keys.length - 1];

            finalVouchingResults.push({
              txn_id: String(txn[txnIdKey] ?? 'UNKNOWN'),
              vendor: txn[allHeaders[1]] || 'UNKNOWN',
              amount_dump: Number(txn[amountKey]) || 0,
              amount_doc: 0,
              confidence: 0.1,
              status: 'flagged',
              auditor_notes: `Flagged: Internal error during audit verification: ${auditErr.message}`
            });
          }
        }

        // 5. Save Results to DB
        const resultsToInsert = finalVouchingResults.map(r => ({
          batch_id: dbBatchId,
          txn_id: r.txn_id || 'UNKNOWN',
          vendor: r.vendor || 'UNKNOWN',
          amount_dump: r.amount_dump || 0,
          amount_doc: r.amount_doc || 0,
          confidence: r.confidence || 0,
          status: r.status || 'flagged',
          auditor_notes: r.auditor_notes
        }));

        await supabase.from('vouching_results').insert(resultsToInsert);
        await supabase.from('batches').update({ status: 'completed' }).eq('id', dbBatchId);
        
        console.log(`Batch ${dbBatchId} completed successfully using PageIndex RAG!`);
      } catch (err) {
        console.error(`Error processing batch ${dbBatchId}:`, err);
        try {
          await supabase.from('batches').update({ status: 'failed' }).eq('id', dbBatchId);
        } catch (dbErr) {
          console.error("Failed to update status to failed:", dbErr);
        }
      }
    }, 0);
    
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Processing Engine running on port ${PORT}`);
});
