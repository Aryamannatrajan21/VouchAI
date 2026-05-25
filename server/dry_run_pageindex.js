// Dry run script to simulate the entire Vectorless PageIndex (PageIndex RAG) matching workflow.
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

// Mock parsed nodes representing a PDF document and a spreadsheet
const mockSupportNodes = [
  {
    nodeType: 'page',
    identifier: 'Page 1',
    fileName: 'Reliance_Industries_Invoice_2024.pdf',
    textPreview: `
      RELIANCE INDUSTRIES LTD.
      Tax Invoice
      Invoice No: INV-2024-8899
      Date: 2024-02-15
      
      Bill To: VouchAI Inc.
      
      Description: Corporate Cloud Subscription Services & Infrastructure Setup
      Total Amount Due: 150,000 INR
      Payment Status: Pending
    `
  },
  {
    nodeType: 'page',
    identifier: 'Page 2',
    fileName: 'Reliance_Industries_Invoice_2024.pdf',
    textPreview: `
      RELIANCE INDUSTRIES LTD.
      Receipt of Payment
      Receipt No: RCP-990022
      Date: 2024-02-18
      
      Received with thanks the sum of 150,000 INR against Invoice No: INV-2024-8899.
      Payment Mode: Bank Transfer
    `
  },
  {
    nodeType: 'sheet',
    identifier: 'Sheet: Tata_Power_Statements',
    fileName: 'Tata_Vendor_Ledger.xlsx',
    textPreview: `
      | Posting Date | Reference | Description | Debits | Credits | Balance |
      | 2024-02-10   | TP-INV-99 | Electricity charges - Phase 1 | 75,000 | 0 | 75,000 |
      | 2024-02-28   | TP-INV-10 | Maintenance charges | 12,000 | 0 | 87,000 |
    `
  }
];

// Mock transactions from Excel dump
const mockTransactions = [
  {
    "Txn ID": "TXN-001",
    "Date": "2024-02-15",
    "Party Name": "Reliance Industries Ltd",
    "Amount": 150000,
    "Ref No": "INV-2024-8899"
  },
  {
    "Txn ID": "TXN-002",
    "Date": "2024-02-10",
    "Party Name": "Tata Power",
    "Amount": 75000,
    "Ref No": "TP-INV-99"
  },
  {
    "Txn ID": "TXN-003",
    "Date": "2024-03-01",
    "Party Name": "Unknown Vendor Inc",
    "Amount": 50000,
    "Ref No": "INV-Unknown"
  }
];

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
        const cleanJSON = jsonStr
          .replace(/\/\/.*?\n/g, '\n')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(cleanJSON);
      } catch (innerErr) {
        throw e; // Throw original JSON.parse error if repair fails
      }
    }
  }
  
  try {
    return JSON.parse(text);
  } catch (e) {
    try {
      const cleanText = text
        .replace(/\/\/.*?\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(cleanText);
    } catch (innerErr) {
      throw e;
    }
  }
}


// Helper from server
async function generateNodeMetadata(node) {
  let response;
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

    response = await openai.chat.completions.create({
      model: "meta/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.05,
      max_tokens: 500,
    });
    
    const text = response.choices[0].message.content.trim();
    return parseRobustJSON(text);
  } catch (err) {
    console.error(`Failed to generate metadata for ${node.fileName}:`, err);
    try {
      console.log("RAW RESPONDED TEXT WAS:", response.choices[0].message.content);
    } catch (e) {}
    return {
      document_type: 'Unknown',
      vendor_name: node.fileName.replace(/\.[^/.]+$/, ""),
      total_amount: 0,
      invoice_number: null,
      date: null,
      summary: `Section: ${node.identifier}`
    };
  }
}

async function dryRun() {
  console.log("--- STARTING DRY RUN FOR VECTORLESS PAGEINDEX RAG ---");
  
  // Phase 1: Compile PageTreeIndex
  console.log("\n[Phase 1] Indexing document nodes...");
  const pageTreeIndex = [];
  for (let i = 0; i < mockSupportNodes.length; i++) {
    const node = mockSupportNodes[i];
    console.log(`Generating metadata for node ${i+1}/${mockSupportNodes.length}: ${node.fileName} (${node.identifier})`);
    const meta = await generateNodeMetadata(node);
    pageTreeIndex.push({
      indexId: i,
      fileName: node.fileName,
      section: node.identifier,
      documentType: meta.document_type,
      vendorName: meta.vendor_name,
      totalAmount: meta.total_amount,
      invoiceNumber: meta.invoice_number,
      date: meta.date,
      summary: meta.summary
    });
  }
  
  console.log("\nCompiled PageTreeIndex Tree:");
  console.log(JSON.stringify(pageTreeIndex, null, 2));

  // Phase 2: Navigation & Reconciliation Matching
  console.log("\n[Phase 2] Simulating Transaction Vouching...");
  const results = [];
  
  for (const txn of mockTransactions) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Auditing Transaction: ID=${txn["Txn ID"]} | Vendor=${txn["Party Name"]} | Amt=${txn["Amount"]}`);
    
    // Step 1: Navigating index
    let candidateIndices = [];
    try {
      const navigationPrompt = `You are a professional financial auditor navigation engine. Given a specific transaction and a structured index of all supporting documents (PageTreeIndex), identify which pages or sheets are highly likely to contain the supporting evidence (such as invoices, receipts, or purchase entries) for this transaction.

TRANSACTION TO AUDIT:
${JSON.stringify(txn, null, 2)}

SUPPORTING DOCUMENTS INDEX (PageTreeIndex):
${JSON.stringify(pageTreeIndex, null, 2)}

INSTRUCTIONS:
1. Search the PageTreeIndex for nodes where the vendor name matches (fuzzy).
2. Look for amounts that match or are close.
3. Output a list of "indexId" numbers of candidate nodes as a raw JSON array.
Return ONLY the JSON array (e.g. [0, 2]). No conversational prefixes.`;

      const navResponse = await openai.chat.completions.create({
        model: "meta/llama-3.1-8b-instruct",
        messages: [{ role: "user", content: navigationPrompt }],
        temperature: 0.05,
        max_tokens: 100,
      });

      const navText = navResponse.choices[0].message.content.trim();
      candidateIndices = parseRobustJSON(navText);
    } catch (err) {
      console.error("Navigation error:", err);
    }

    console.log(`Navigation candidates selected:`, candidateIndices);

    if (!candidateIndices || candidateIndices.length === 0) {
      results.push({
        txn_id: txn["Txn ID"],
        vendor: txn["Party Name"],
        amount_dump: txn["Amount"],
        amount_doc: 0,
        confidence: 0.0,
        status: 'flagged',
        auditor_notes: 'Flagged: No matching supporting documents could be located in the PageTreeIndex.'
      });
      continue;
    }

    // Step 2: Fetch detailed candidate content
    const detailedContent = candidateIndices.map(id => {
      const node = mockSupportNodes[id];
      return `--- File: ${node.fileName} | ${node.identifier} ---\n${node.textPreview}`;
    }).join('\n\n');

    // Step 3: Reconciliation
    try {
      const reconciliationPrompt = `You are an expert financial auditor performing a detailed vouching audit. Your task is to reconcile a single transaction row against the selected detailed contents of the supporting documents.

TRANSACTION DETAILS:
${JSON.stringify(txn, null, 2)}

SUPPORTING DOCUMENT DETAILS:
${detailedContent}

AUDITING INSTRUCTIONS:
Perform a strict column-by-column reconciliation:
1. Vendor Name fuzzy match.
2. Amount check.
3. Date proximity.
4. Reference checking.

Return ONLY a raw JSON object matching the following structure. No markdown formatting, no conversational text.
{
  "vendor": "<inferred vendor name>",
  "amount_doc": <numeric amount from the support document, or 0 if not found>,
  "confidence": <confidence score 0.0 to 1.0>,
  "status": "matched" | "mismatched" | "flagged",
  "auditor_notes": "<highly detailed, professional audit note explaining the exact comparison of vendor, amount, date, and references. YOU MUST CITE the exact file name and page/sheet number where the evidence was found.>"
}`;

      const auditResponse = await openai.chat.completions.create({
        model: "meta/llama-3.1-8b-instruct",
        messages: [{ role: "user", content: reconciliationPrompt }],
        temperature: 0.05,
        max_tokens: 800,
      });

      const auditText = auditResponse.choices[0].message.content.trim();
      const auditResult = parseRobustJSON(auditText);

      results.push({
        txn_id: txn["Txn ID"],
        vendor: auditResult.vendor,
        amount_dump: txn["Amount"],
        amount_doc: auditResult.amount_doc,
        confidence: auditResult.confidence,
        status: auditResult.status,
        auditor_notes: auditResult.auditor_notes
      });

    } catch (auditErr) {
      console.error("Reconciliation error:", auditErr);
    }
  }

  console.log(`\n==================================================`);
  console.log("FINAL AUDIT RESULTS SUMMARY:");
  console.log(JSON.stringify(results, null, 2));
  console.log("--- DRY RUN COMPLETED SUCCESSFULY ---");
}

dryRun();
