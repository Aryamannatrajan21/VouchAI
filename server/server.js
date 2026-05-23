require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const xlsx = require('xlsx');

global.WebSocket = require('ws');

const { encryptText, decryptText, wrapKey, unwrapKey, generateSecureKeyIV, decryptBuffer } = require('./crypto_helper');

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

// Helper: Sleep utility
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Robustly retry API calls on 429 Rate Limits with Exponential Backoff
async function retryOpenAICall(fn, retries = 5, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.status === 429 || 
                          (err.message && err.message.includes('429')) ||
                          (err.status === 503) ||
                          (err.message && err.message.includes('503'));
      if (isRateLimit && i < retries - 1) {
        const waitTime = delay * Math.pow(2, i) + Math.random() * 1000;
        console.warn(`[API Rate Limit/Overload] Retrying in ${Math.round(waitTime)}ms... (Attempt ${i+1}/${retries})`);
        await sleep(waitTime);
      } else {
        throw err;
      }
    }
  }
}

// Helper: robustly parse JSON from LLM output by extracting the balanced bracket/brace structure
function parseRobustJSON(text) {
  text = text.trim();
  
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n/, '');
    text = text.replace(/\n```$/, '');
    text = text.trim();
  }
  
  text = text.replace(/(:\s*)(\d{1,3}(?:,\d{3})+(\.\d+)?)/g, (match, p1, p2) => {
    return p1 + p2.replace(/,/g, '');
  });
  
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escape = false;
  let startIdx = -1;
  let endIdx = -1;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{' || char === '[') {
        if (startIdx === -1) {
          startIdx = i;
        }
        if (char === '{') braceCount++;
        if (char === '[') bracketCount++;
      } else if (char === '}' || char === ']') {
        if (char === '}') braceCount--;
        if (char === ']') bracketCount--;
        
        if (startIdx !== -1 && braceCount === 0 && bracketCount === 0) {
          endIdx = i;
          break;
        }
      }
    }
  }
  
  let jsonStr = text;
  if (startIdx !== -1 && endIdx !== -1) {
    jsonStr = text.substring(startIdx, endIdx + 1);
  }
  
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    try {
      let cleanJS = jsonStr.replace(/\/\/.*?\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
      return Function(`return (${cleanJS});`)();
    } catch (innerErr) {
      try {
        return eval(`(${jsonStr})`);
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

// Helper: Parse PDF page by page using PDFParse class
async function parsePDFPages(buffer) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  
  if (!result.pages || result.pages.length === 0) {
    return [{
      nodeType: 'page',
      identifier: 'Page 1',
      rawText: result.text || '',
      textPreview: (result.text || '').substring(0, 1500)
    }];
  }
  
  return result.pages.map(page => ({
    nodeType: 'page',
    identifier: `Page ${page.num}`,
    rawText: page.text || '',
    textPreview: (page.text || '').substring(0, 1500)
  }));
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
1. "document_type": e.g. "Invoice", "Receipt", "Purchase Order", "Delivery Note", "Bank Statement", "Ledger", "Fixed Deposit Advice", "Email Approval", or "Unknown"
2. "vendor_name": The exact name of the vendor, party, supplier, client, bank, or sender. (e.g. "HSBC Bank")
3. "total_amount": The primary total, principal amount, or invoice amount as a clean number (e.g. 90000000.00). 0 if not found.
4. "invoice_number": The invoice number, reference number, account number, or bill ID. null if not found.
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

    const response = await retryOpenAICall(async () => {
      return await openai.chat.completions.create({
        model: "meta/llama-3.1-8b-instruct",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.05,
        max_tokens: 500,
      });
    });
    
    const text = response.choices[0].message.content.trim();
    return parseRobustJSON(text);
  } catch (err) {
    console.error(`Failed to generate metadata for ${node.fileName} (${node.identifier}):`, err);
    return {
      document_type: 'Unknown',
      vendor_name: node.fileName.replace(/\.[^/.]+$/, ""),
      total_amount: 0,
      invoice_number: null,
      date: null,
      summary: `Supporting document section: ${node.identifier}`
    };
  }
}

// 1. Secure Upload Preparation Endpoint
app.post('/api/prepare-upload', async (req, res) => {
  try {
    const { filename, mimeType, clientId } = req.body;
    if (!filename || !clientId) {
      return res.status(400).json({ error: 'Missing filename or clientId' });
    }
    
    const timestamp = Date.now();
    const storagePath = `${clientId}/${timestamp}_${filename}`;
    
    // Generate signed upload URL from Supabase (bypassing Express payload limits & keeping it secure)
    const { data, error } = await supabase.storage
      .from('uploads')
      .createSignedUploadUrl(storagePath);
      
    if (error) throw error;
    
    // Generate ephemeral AES-GCM file key credentials
    const credentials = generateSecureKeyIV();
    const wrappedKey = wrapKey(credentials.key);
    
    // Write key mapping to PG
    const { error: keyError } = await supabase
      .from('file_keys')
      .insert({
        file_url: storagePath,
        wrapped_key: wrappedKey,
        iv: credentials.iv
      });
      
    if (keyError) throw keyError;
    
    res.json({
      signedUrl: data.signedUrl,
      fileUrl: storagePath,
      clearKey: credentials.key,
      iv: credentials.iv
    });
    
  } catch (err) {
    console.error("Prepare upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Encrypted Batch & Document Creation Endpoint
app.post('/api/create-batch', async (req, res) => {
  try {
    const { clientId, excelPath, supportPaths, processingMode } = req.body;
    
    if (!excelPath || !clientId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const rawExcelName = excelPath.split('/').pop().split('_').slice(1).join('_') || excelPath.split('/').pop();
    const encryptedExcelName = encryptText(rawExcelName);
    
    // Insert encrypted batch row
    const { data: batchData, error: batchError } = await supabase
      .from('batches')
      .insert({
        user_id: clientId,
        filename: encryptedExcelName,
        file_url: excelPath,
        status: 'processing'
      })
      .select('id')
      .single();

    if (batchError) throw batchError;
    const dbBatchId = batchData.id;
    
    // Insert encrypted document rows
    for (const path of supportPaths) {
      const rawName = path.split('/').pop().split('_').slice(1).join('_') || path.split('/').pop();
      const encryptedName = encryptText(rawName);
      
      const { error: docError } = await supabase
        .from('documents')
        .insert({
          batch_id: dbBatchId,
          filename: encryptedName,
          file_url: path
        });
      if (docError) console.error("Error creating document record:", docError);
    }
    
    res.json({ message: 'Secure batch created and processing started', batchId: dbBatchId });

    // AI Processing Loop on Decrypted Streams in-memory
    setTimeout(async () => {
      try {
        console.log(`Starting secure decrypted AI processing for batch ${dbBatchId}...`);
        const isTurbo = processingMode === '8b';

        // 1. Download and Decrypt Transaction Excel Dump in-memory
        const { data: excelKeyRow, error: ekErr } = await supabase
          .from('file_keys')
          .select('wrapped_key, iv')
          .eq('file_url', excelPath)
          .single();
        if (ekErr || !excelKeyRow) throw new Error("Missing file key for excel dump: " + excelPath);
        
        const excelKey = unwrapKey(excelKeyRow.wrapped_key);
        const excelIv = excelKeyRow.iv;

        const { data: excelBlob, error: downloadError } = await supabase.storage.from('uploads').download(excelPath);
        if (downloadError) throw downloadError;

        const excelBuf = Buffer.from(await excelBlob.arrayBuffer());
        const decryptedExcelBuf = decryptBuffer(excelBuf, excelKey, excelIv);

        const workbook = xlsx.read(decryptedExcelBuf, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const allRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        console.log(`Extracted ${allRows.length} rows securely from decrypted transaction Excel dump.`);

        if (allRows.length === 0) {
          throw new Error('No transactions found in the Excel dump.');
        }

        const allHeaders = Object.keys(allRows[0]);
        const txnRows = allRows.slice(0, 25); // Audit limit up to 25 transactions

        // 2. Download and Decrypt Supporting Documents to build PageTreeIndex
        console.log(`Building secure PageTreeIndex for ${supportPaths.length} supporting documents...`);
        let supportNodes = [];

        for (const path of supportPaths) {
          const { data: keyRow, error: kErr } = await supabase
            .from('file_keys')
            .select('wrapped_key, iv')
            .eq('file_url', path)
            .single();
          if (kErr || !keyRow) continue;

          const fileKey = unwrapKey(keyRow.wrapped_key);
          const fileIv = keyRow.iv;

          const { data: supportBlob } = await supabase.storage.from('uploads').download(path);
          if (!supportBlob) continue;
          
          const rawBuf = Buffer.from(await supportBlob.arrayBuffer());
          const decryptedBuf = decryptBuffer(rawBuf, fileKey, fileIv);
          
          const fileName = path.split('/').pop().split('_').slice(1).join('_') || path.split('/').pop();
          const ext = path.split('.').pop().toLowerCase();
          
          if (['xlsx','csv','xls','xlsm','xlsb'].includes(ext)) {
            const sheets = await parseExcelSheets(decryptedBuf);
            sheets.forEach(s => {
              s.fileName = fileName;
              supportNodes.push(s);
            });
          } else if (ext === 'pdf') {
            try {
              const pages = await parsePDFPages(decryptedBuf);
              pages.forEach(p => {
                p.fileName = fileName;
                supportNodes.push(p);
              });
            } catch (pdfErr) {
              console.error(`Failed to parse PDF ${fileName}:`, pdfErr);
            }
          }
        }

        // Generate metadata summaries for all nodes sequentially with rate limit protection
        console.log(`Indexing ${supportNodes.length} decrypted document pages/sheets using Llama 3.1 8B...`);
        for (let i = 0; i < supportNodes.length; i++) {
          const node = supportNodes[i];
          node.metadata = await generateNodeMetadata(node);
          await sleep(500); // 500ms delay to respect API rate limits
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

        console.log(`PageTreeIndex fully compiled with ${pageTreeIndex.length} nodes.`);

        // 3. Navigation & Matching Loop
        const finalVouchingResults = [];

        for (let idx = 0; idx < txnRows.length; idx++) {
          const txn = txnRows[idx];
          console.log(`[${idx+1}/${txnRows.length}] Secure Auditing transaction: ID = ${txn[allHeaders[0]] || 'N/A'}`);

          // Step 1: Reasoning-Based Navigation
          let candidateIndices = [];
          try {
            const navigationPrompt = `You are a professional financial auditor data lookup assistant. Given a specific transaction and a structured index of all supporting documents (PageTreeIndex), identify which indexId numbers are highly likely to contain the supporting evidence (such as invoices, fixed deposit advices, bank statements, or approval emails) for this transaction.

TRANSACTION TO AUDIT:
${JSON.stringify(txn, null, 2)}

SUPPORTING DOCUMENTS INDEX (PageTreeIndex):
${JSON.stringify(pageTreeIndex, null, 2)}

INSTRUCTIONS:
1. Search the PageTreeIndex for nodes where the vendor or account name matches (fuzzy).
2. Look for matching amounts or values.
3. Output a list of "indexId" numbers of the candidate pages/sheets as a raw JSON array.
4. Return ONLY a raw JSON array of integers representing the indexIds. Do not write code or text.
Example: [0, 2]`;

            const navResponse = await retryOpenAICall(async () => {
              return await openai.chat.completions.create({
                model: "meta/llama-3.1-8b-instruct",
                messages: [{ role: "user", content: navigationPrompt }],
                temperature: 0.05,
                max_tokens: 100,
              });
            });

            const navText = navResponse.choices[0].message.content.trim();
            candidateIndices = parseRobustJSON(navText);
            if (!Array.isArray(candidateIndices)) candidateIndices = [];
            
            // Clean and validate candidateIndices
            candidateIndices = candidateIndices
              .map(x => parseInt(x, 10))
              .filter(x => !isNaN(x) && x >= 0 && x < supportNodes.length);
          } catch (navErr) {
            console.error("Navigation error:", navErr);
          }

          // Double-Layered Protection: Fallback to local keyword/fuzzy matching if LLM navigation returned empty
          if (candidateIndices.length === 0) {
            const keys = Object.keys(txn);
            const vendorKey = allHeaders[1] || keys[1] || 'Vendor';
            const amountKey = keys.find(k => k.toLowerCase().includes('amt') || k.toLowerCase().includes('amount') || k.toLowerCase().includes('val') || k.toLowerCase().includes('price')) || keys[keys.length - 1];
            
            const vendorQuery = (txn[vendorKey] || '').toLowerCase().split(/[\s,]+/)[0];
            const amountQuery = String(txn[amountKey] || '');
            
            candidateIndices = pageTreeIndex.filter(p => {
              const vName = (p.vendorName || '').toLowerCase();
              const summary = (p.summary || '').toLowerCase();
              const docType = (p.documentType || '').toLowerCase();
              const fName = (p.fileName || '').toLowerCase();
              
              const amountMatch = amountQuery && (summary.includes(amountQuery) || String(p.totalAmount).includes(amountQuery));
              const vendorMatch = vendorQuery && (vName.includes(vendorQuery) || summary.includes(vendorQuery) || fName.includes(vendorQuery));
              
              return amountMatch || vendorMatch;
            }).map(p => p.indexId);
            
            if (candidateIndices.length === 0) {
              candidateIndices = [0];
            }
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
1. **Vendor Name**: Check if the vendor/bank name matches (fuzzy).
2. **Amount**: Check if the amount matches (check exact and decimal matches).
3. **Date**: Verify if the transaction date corresponds to the document date.
4. **Reference Numbers**: Reconcile account/invoice numbers or references.

DETERMINE STATUS & CONFIDENCE:
- If vendor and amount match exactly/closely, and references correlate → status: "matched", confidence: 0.95 to 1.0.
- If vendor matches but amount differs → status: "mismatched", confidence: 0.5 to 0.8.
- If details are conflicting or missing → status: "flagged", confidence: 0.0 to 0.4.

Return ONLY a raw JSON object matching the following structure. No markdown code blocks, no conversational text.
{
  "vendor": "<inferred vendor>",
  "amount_doc": <numeric amount or 0>,
  "confidence": <confidence score 0.0 to 1.0>,
  "status": "matched" | "mismatched" | "flagged",
  "auditor_notes": "<highly detailed, professional audit note explaining comparison and CITING exact filename & page.>"
}`;

            const modelName = isTurbo ? "meta/llama-3.1-8b-instruct" : "meta/llama-3.3-70b-instruct";
            const auditResponse = await retryOpenAICall(async () => {
              return await openai.chat.completions.create({
                model: modelName,
                messages: [{ role: "user", content: reconciliationPrompt }],
                temperature: 0.05,
                max_tokens: 800,
              });
            });
            await sleep(300); // rate limit padding spacing

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

        // 4. Save Encrypted Results to DB
        console.log(`Writing symmetrically encrypted audit results to vouching_results table...`);
        const resultsToInsert = finalVouchingResults.map(r => ({
          batch_id: dbBatchId,
          txn_id: encryptText(r.txn_id),
          vendor: encryptText(r.vendor),
          amount_dump: encryptText(r.amount_dump),
          amount_doc: encryptText(r.amount_doc),
          confidence: encryptText(r.confidence),
          status: r.status, // Keep clear to enable frontend RLS filters and status counts
          auditor_notes: encryptText(r.auditor_notes)
        }));

        await supabase.from('vouching_results').insert(resultsToInsert);
        await supabase.from('batches').update({ status: 'completed' }).eq('id', dbBatchId);
        
        console.log(`Secure batch ${dbBatchId} completed successfully using PageIndex RAG!`);
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

// 3. Batches Listing API (with metadata decryption)
app.get('/api/batches', async (req, res) => {
  try {
    const { userId } = req.query;
    let query = supabase.from('batches').select('*');
    if (userId) {
      query = query.eq('user_id', userId);
    }
    const { data: rawBatches, error } = await query.order('created_at', { ascending: false });
      
    if (error) throw error;
    
    // Decrypt batch filenames
    const decryptedBatches = (rawBatches || []).map(b => ({
      ...b,
      filename: decryptText(b.filename)
    }));
    
    res.json(decryptedBatches);
  } catch (err) {
    console.error("Fetch batches error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Vouching Results Decryption & Retrieval API
app.get('/api/batches/:id/results', async (req, res) => {
  try {
    const batchId = req.params.id;
    const { data: encryptedResults, error } = await supabase
      .from('vouching_results')
      .select('*')
      .eq('batch_id', batchId);
      
    if (error) throw error;
    
    // Decrypt all sensitive column fields
    const decryptedResults = (encryptedResults || []).map(r => ({
      id: r.id,
      batch_id: r.batch_id,
      txn_id: decryptText(r.txn_id),
      vendor: decryptText(r.vendor),
      amount_dump: Number(decryptText(r.amount_dump)) || 0,
      amount_doc: Number(decryptText(r.amount_doc)) || 0,
      confidence: Number(decryptText(r.confidence)) || 0,
      status: r.status,
      auditor_notes: decryptText(r.auditor_notes),
      created_at: r.created_at
    }));
    
    res.json(decryptedResults);
  } catch (err) {
    console.error("Fetch batch results error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Secure Decrypted Document Streaming Endpoint
app.get('/api/batches/:id/document', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: "Missing document path" });
    }

    // Fetch File Key & IV mapping from database
    const { data: keyRow, error: kErr } = await supabase
      .from('file_keys')
      .select('wrapped_key, iv')
      .eq('file_url', filePath)
      .single();
      
    if (kErr || !keyRow) {
      return res.status(404).json({ error: "File keys mapping not found for path: " + filePath });
    }

    const fileKey = unwrapKey(keyRow.wrapped_key);
    const fileIv = keyRow.iv;

    // Download encrypted blob from Supabase
    const { data: blob, error: downloadError } = await supabase.storage
      .from('uploads')
      .download(filePath);
      
    if (downloadError || !blob) {
      throw downloadError || new Error("Failed to download file blob");
    }

    // Decrypt buffer strictly in-memory
    const encryptedBuf = Buffer.from(await blob.arrayBuffer());
    const decryptedBuf = decryptBuffer(encryptedBuf, fileKey, fileIv);

    // Determine appropriate Content-Type
    const ext = filePath.split('.').pop().toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === 'pdf') {
      contentType = 'application/pdf';
    } else if (ext === 'png') {
      contentType = 'image/png';
    } else if (['jpg', 'jpeg'].includes(ext)) {
      contentType = 'image/jpeg';
    } else if (ext === 'xlsx') {
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (ext === 'xls') {
      contentType = 'application/vnd.ms-excel';
    } else if (ext === 'csv') {
      contentType = 'text/csv';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', decryptedBuf.length);
    res.send(decryptedBuf);

  } catch (err) {
    console.error("Stream document error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Manual Auditor Override Status & Notes Endpoint
app.post('/api/results/:id/override', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, auditor_notes } = req.body;

    if (!status) {
      return res.status(400).json({ error: "Missing status parameter" });
    }

    const updates = {};
    updates.status = status;

    if (auditor_notes !== undefined) {
      updates.auditor_notes = encryptText(auditor_notes);
    }

    const { data, error } = await supabase
      .from('vouching_results')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    res.json({
      message: "Result overridden successfully",
      result: {
        ...data,
        txn_id: decryptText(data.txn_id),
        vendor: decryptText(data.vendor),
        amount_dump: Number(decryptText(data.amount_dump)) || 0,
        amount_doc: Number(decryptText(data.amount_doc)) || 0,
        confidence: Number(decryptText(data.confidence)) || 0,
        auditor_notes: decryptText(data.auditor_notes)
      }
    });

  } catch (err) {
    console.error("Override result error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Secure Zero-Trust Auditing Engine running on port ${PORT}`);
});
