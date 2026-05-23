require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
global.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { PDFParse } = require('pdf-parse');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  
  // Balanced bracket/brace extractor to pull the first complete JSON object or array
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

// Helper: Generate metadata for a page/sheet node using Llama 3.1 8B
async function generateNodeMetadata(node) {
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

async function startAudit() {
  console.log("=== STARTING REAL FDR AUDIT ENGINE ===");
  
  // 1. Get Client ID from DB
  const { data: profiles, error: pError } = await supabase.from('profiles').select('id').limit(1);
  if (pError || profiles.length === 0) {
    throw new Error("No profiles found in the database. Please register a user first.");
  }
  const clientId = profiles[0].id;
  console.log(`Using Profile/Client ID: ${clientId}`);

  // 2. Read transactions spreadsheet
  const excelPath = '/Users/macair/Downloads/Vouch AI/FD_Transactions.xlsx';
  const workbook = xlsx.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const allRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  console.log(`Loaded ${allRows.length} transactions to reconcile.`);

  // 3. Create a Batch record in Supabase
  const { data: batchData, error: batchError } = await supabase
    .from('batches')
    .insert({
      user_id: clientId,
      filename: 'FD_Transactions.xlsx',
      file_url: 'local://Downloads/Vouch AI/FD_Transactions.xlsx',
      status: 'processing'
    })
    .select('id')
    .single();

  if (batchError) throw batchError;
  const dbBatchId = batchData.id;
  console.log(`Created DB Batch record with ID: ${dbBatchId}`);

  // 4. Load & parse PDF supporting documents
  const fdrDir = '/Users/macair/Downloads/Vouch AI/FDR';
  const mailDir = '/Users/macair/Downloads/Vouch AI/Mail Confirmtion';
  
  const fdrFiles = fs.readdirSync(fdrDir).filter(f => f.endsWith('.pdf'));
  const mailFiles = fs.readdirSync(mailDir).filter(f => f.endsWith('.pdf'));
  
  console.log(`Found ${fdrFiles.length} FDR advices and ${mailFiles.length} email approval PDFs.`);
  
  let supportNodes = [];
  
  // Parse FDRs
  for (const file of fdrFiles) {
    console.log(`Parsing FDR: ${file}...`);
    const buffer = fs.readFileSync(path.join(fdrDir, file));
    const pages = await parsePDFPages(buffer);
    pages.forEach(p => {
      p.fileName = file;
      supportNodes.push(p);
    });
  }
  
  // Parse Mails
  for (const file of mailFiles) {
    console.log(`Parsing Mail Confirmation: ${file}...`);
    const buffer = fs.readFileSync(path.join(mailDir, file));
    const pages = await parsePDFPages(buffer);
    pages.forEach(p => {
      p.fileName = file;
      supportNodes.push(p);
    });
  }

  console.log(`\nGenerated ${supportNodes.length} page/sheet nodes from PDFs.`);
  
  // 5. Indexing: generate metadata for all supportNodes
  console.log("Generating metadata and building PageTreeIndex using Llama 3.1 8B...");
  const pageTreeIndex = [];
  
  for (let i = 0; i < supportNodes.length; i++) {
    const node = supportNodes[i];
    console.log(`  [Node ${i+1}/${supportNodes.length}] Indexing: ${node.fileName} (${node.identifier})`);
    
    // Process with retries & a small spacing delay to respect rate limit caps
    const metadata = await generateNodeMetadata(node);
    node.metadata = metadata;
    await sleep(600); // 600ms spacing to maintain optimal throughput without triggering 429
    
    pageTreeIndex.push({
      indexId: i,
      fileName: node.fileName,
      section: node.identifier,
      documentType: metadata.document_type,
      vendorName: metadata.vendor_name,
      totalAmount: metadata.total_amount,
      invoiceNumber: metadata.invoice_number,
      date: metadata.date,
      summary: metadata.summary
    });
  }
  
  console.log("\nPageTreeIndex successfully built:");
  console.log(JSON.stringify(pageTreeIndex, null, 2));

  // 6. Navigation & Matching Loop
  const finalVouchingResults = [];
  
  for (let idx = 0; idx < allRows.length; idx++) {
    const txn = allRows[idx];
    console.log(`\n==================================================`);
    console.log(`[Transaction ${idx+1}/${allRows.length}] Auditing: ID=${txn["Transaction ID"]} | Vendor=${txn["Vendor"]} | Amt=${txn["Amount"]} | Ref=${txn["Reference Number"]}`);

    // Step 1: Reasoning-Based Navigation
    let candidateIndices = [];
    try {
      const navigationPrompt = `You are a professional financial auditor data lookup assistant. Given a specific transaction and a structured index of all supporting documents (PageTreeIndex), identify which indexId numbers are highly likely to contain the supporting evidence (such as invoices, receipts, bank statements, fixed deposit advices, or approval emails) for this transaction.

TRANSACTION TO AUDIT:
${JSON.stringify(txn, null, 2)}

SUPPORTING DOCUMENTS INDEX (PageTreeIndex):
${JSON.stringify(pageTreeIndex, null, 2)}

INSTRUCTIONS:
1. Search the PageTreeIndex for nodes where the vendor or account name matches (fuzzy, check for HSBC, bank, or specific entity names like Sprng, Arinsun, Suryoday, Transform, Ujjvala).
2. Look for amounts that match or are close (e.g. 3.25 Crores = 32,500,000, 9 Crores = 90,000,000, 1.5 Crores = 15,00,00,000, 39 Crores = 39,00,00,000).
3. Look for matching dates or references.
4. Output a list of "indexId" numbers of the candidate pages/sheets. If no pages are relevant, return an empty array.
5. Return ONLY a raw JSON array of integers representing the indexIds. Do not write any code, text, or markdown code fences.
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
      
      // Clean and validate candidateIndices (ensure they are integers inside bounds)
      candidateIndices = candidateIndices
        .map(x => parseInt(x, 10))
        .filter(x => !isNaN(x) && x >= 0 && x < supportNodes.length);
    } catch (navErr) {
      console.error("Navigation error:", navErr);
    }

    // Double-Layered Protection: Perform local keyword/fuzzy matching fallback if LLM navigation returned empty or failed
    if (candidateIndices.length === 0) {
      console.log("LLM Navigation returned empty or failed. Triggering robust local keyword/amount matching engine...");
      const vendorQuery = (txn["Vendor"] || '').toLowerCase().split(/[\s,]+/)[0]; // Grab first word (e.g. "Patil" or "Gupta" or "HSBC")
      const amountQuery = String(txn["Amount"] || '');
      
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
        candidateIndices = [0]; // Fallback to first page if absolutely nothing matches
      }
    }

    console.log(`Final selected candidate index IDs for auditing:`, candidateIndices);

    // Step 2: Fetch detailed raw contents for candidate nodes
    const candidateDocsContent = candidateIndices.map(id => {
      const node = supportNodes[id];
      return `--- File: ${node.fileName} | ${node.identifier} ---\n${node.rawText}`;
    }).join('\n\n');

    // Step 3: Column-by-column Reconciliation
    try {
      const reconciliationPrompt = `You are an expert financial auditor performing a detailed vouching audit. Your task is to reconcile a single transaction row against the selected detailed contents of the supporting documents.

TRANSACTION DETAILS:
${JSON.stringify(txn, null, 2)}

SUPPORTING DOCUMENT DETAILS:
${candidateDocsContent}

AUDITING INSTRUCTIONS:
Perform a strict column-by-column reconciliation:
1. **Vendor Name**: Check if the vendor/bank name matches (fuzzy, check for HSBC, Hongkong Bank, email sender names, etc.).
2. **Amount**: Check if the amount matches (exact matches, fuzzy or decimal matches, check Indian numbering representations e.g. 3.25 Cr is 32,500,000, 9 Cr is 90,000,000, 39 Cr is 390,000,000).
3. **Date**: Verify if the transaction date corresponds to the document date.
4. **Reference Numbers**: Reconcile account numbers, reference numbers, or invoice IDs.

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

      // Use Llama 3.3 70B for the deep audit step
      const auditResponse = await retryOpenAICall(async () => {
        return await openai.chat.completions.create({
          model: "meta/llama-3.3-70b-instruct",
          messages: [{ role: "user", content: reconciliationPrompt }],
          temperature: 0.05,
          max_tokens: 800,
        });
      });

      const auditText = auditResponse.choices[0].message.content.trim();
      const auditResult = parseRobustJSON(auditText);

      finalVouchingResults.push({
        txn_id: String(txn["Transaction ID"]),
        vendor: auditResult.vendor || txn["Vendor"] || 'UNKNOWN',
        amount_dump: Number(txn["Amount"]) || 0,
        amount_doc: Number(auditResult.amount_doc) || 0,
        confidence: Number(auditResult.confidence) || 0,
        status: auditResult.status || 'flagged',
        auditor_notes: auditResult.auditor_notes || 'Processed by PageIndex RAG engine.'
      });

    } catch (auditErr) {
      console.error(`Audit error for transaction:`, auditErr);
      finalVouchingResults.push({
        txn_id: String(txn["Transaction ID"]),
        vendor: txn["Vendor"] || 'UNKNOWN',
        amount_dump: Number(txn["Amount"]) || 0,
        amount_doc: 0,
        confidence: 0.1,
        status: 'flagged',
        auditor_notes: `Flagged: Internal error during audit verification: ${auditErr.message}`
      });
    }
    
    await sleep(400); // 400ms delay between audits to stay well under API rate limits
  }

  // 7. Save results to database
  console.log("\nSaving results to Supabase 'vouching_results'...");
  const resultsToInsert = finalVouchingResults.map(r => ({
    batch_id: dbBatchId,
    txn_id: r.txn_id,
    vendor: r.vendor,
    amount_dump: r.amount_dump,
    amount_doc: r.amount_doc,
    confidence: r.confidence,
    status: r.status,
    auditor_notes: r.auditor_notes
  }));

  const { error: insertError } = await supabase.from('vouching_results').insert(resultsToInsert);
  if (insertError) throw insertError;

  // Update batch status to completed
  const { error: updateError } = await supabase.from('batches').update({ status: 'completed' }).eq('id', dbBatchId);
  if (updateError) throw updateError;
  
  console.log(`Updated Batch ${dbBatchId} status to 'completed'.`);

  // 8. Export beautiful report workbook to Downloads
  console.log("\nExporting final report to '/Users/macair/Downloads/FDR_Audit_Results.xlsx'...");
  const outWb = xlsx.utils.book_new();
  const outWs = xlsx.utils.json_to_sheet(finalVouchingResults);
  xlsx.utils.book_append_sheet(outWb, outWs, 'Audit Results');
  xlsx.writeFile(outWb, '/Users/macair/Downloads/FDR_Audit_Results.xlsx');
  
  console.log("=== VOUCH REAL FDR AUDIT ENGINE COMPLETED SUCCESSFULY ===");
}

startAudit().catch(err => {
  console.error("Audit Engine execution failed:", err);
  process.exit(1);
});
