require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
// pdf-parse and xlsx are lazy-loaded inside functions to avoid filesystem errors in Vercel serverless

const { encryptText, decryptText, wrapKey, unwrapKey, generateSecureKeyIV, decryptBuffer } = require('./crypto_helper');

const app = express();

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NVIDIA_API_KEY', 'ENCRYPTION_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
}

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(cors({
  origin: true, // Allow all origins for Vercel deployments
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));

// Set up Supabase admin client (bypasses RLS so the AI engine can write results)
// Node 20 requires explicit ws transport for Supabase realtime
const ws = require('ws');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // Requires Service Role Key
  {
    realtime: { transport: ws }
  }
);

// Set up Nvidia OpenAI Client
const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

// Helper: Sleep utility
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid bearer token' });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    req.auth = {
      user: data.user,
      role: profile?.role || 'user'
    };
    next();
  } catch (err) {
    next(err);
  }
}

function canAccessUser(req, userId) {
  return req.auth?.user?.id === userId || ['admin', 'auditor'].includes(req.auth?.role);
}

async function getBatchForAccess(batchId) {
  const { data, error } = await supabase
    .from('batches')
    .select('id, user_id, file_url')
    .eq('id', batchId)
    .single();
  if (error || !data) return null;
  return data;
}

async function requireBatchAccess(req, res, next) {
  try {
    const batch = await getBatchForAccess(req.params.id);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    if (!canAccessUser(req, batch.user_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.batch = batch;
    next();
  } catch (err) {
    next(err);
  }
}

function sanitizeStorageFilename(filename) {
  return String(filename || '')
    .replace(/[/\\]/g, '_')
    .replace(/[^\w.\- ()]/g, '_')
    .slice(0, 180);
}

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
      const cleanJSON = jsonStr
        .replace(/\/\/.*?\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(cleanJSON);
    } catch (innerErr) {
      throw e;
    }
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Helper: convert an array of objects into a clean markdown table string
function toMarkdownTable(rows) {
  if (!rows || rows.length === 0) return '(empty)';
  const headers = Object.keys(rows[0]);
  const divider = headers.map(h => '-'.repeat(Math.max(h.length, 6))).join(' | ');
  const headerRow = headers.join(' | ');
  const dataRows = rows.map(r => headers.map(h => String(r[h] ?? '')).join(' | '));
  return [headerRow, divider, ...dataRows].join('\n');
}

function normalizeAuditResult(auditResult, txn, allHeaders, candidateNodes) {
  const keys = Object.keys(txn);
  const txnIdKey = keys.find(k => k.toLowerCase().includes('id') || k.toLowerCase().includes('ref') || k.toLowerCase().includes('no')) || keys[0];
  const amountKey = keys.find(k => k.toLowerCase().includes('amt') || k.toLowerCase().includes('amount') || k.toLowerCase().includes('val') || k.toLowerCase().includes('price')) || keys[keys.length - 1];

  const parameterMatches = Array.isArray(auditResult.parameter_matches)
    ? auditResult.parameter_matches.map((item) => ({
        parameter: String(item.parameter || ''),
        dump_value: item.dump_value ?? '',
        evidence_value: item.evidence_value ?? '',
        status: ['matched', 'mismatched', 'missing', 'not_applicable'].includes(item.status) ? item.status : 'missing',
        source_file: item.source_file || '',
        source_section: item.source_section || '',
        reference_number: item.reference_number || '',
        explanation: item.explanation || ''
      }))
    : [];

  const evidenceFiles = Array.isArray(auditResult.evidence_files)
    ? auditResult.evidence_files
    : candidateNodes.map((node) => `${node.fileName} (${node.identifier})`);

  const referenceNumbers = Array.isArray(auditResult.reference_numbers)
    ? auditResult.reference_numbers
    : [];

  const statuses = parameterMatches.map((item) => item.status);
  const hasMismatch = statuses.includes('mismatched');
  const hasMissing = statuses.includes('missing');
  const matchedCount = statuses.filter((status) => status === 'matched' || status === 'not_applicable').length;
  const totalCount = Math.max(statuses.length, 1);

  let status = auditResult.status;
  if (!['matched', 'mismatched', 'flagged'].includes(status)) {
    status = hasMismatch ? 'mismatched' : hasMissing ? 'flagged' : 'matched';
  }

  const computedConfidence = Math.min(1, Math.max(0, matchedCount / totalCount));
  const confidence = Number.isFinite(Number(auditResult.confidence))
    ? Math.min(1, Math.max(0, Number(auditResult.confidence)))
    : computedConfidence;

  return {
    txn_id: String(auditResult.transaction_id || (txn[txnIdKey] ?? 'UNKNOWN')),
    vendor: auditResult.vendor || txn[allHeaders[1]] || 'UNKNOWN',
    amount_dump: Number(txn[amountKey]) || 0,
    amount_doc: Number(auditResult.amount_doc) || 0,
    confidence,
    status,
    auditor_notes: auditResult.auditor_notes || 'Processed by CA-style parameter reconciliation engine.',
    match_details: parameterMatches,
    evidence_files: evidenceFiles,
    reference_numbers: referenceNumbers
  };
}

function parseEncryptedJSONField(value, fallback) {
  const decrypted = decryptText(value);
  if (!decrypted) return fallback;
  try {
    return JSON.parse(decrypted);
  } catch (_err) {
    return fallback;
  }
}

// Helper: Parse PDF page by page using pdf-parse (lazy-loaded to avoid Vercel startup crash)
async function parsePDFPages(buffer) {
  const { PDFParse } = require('pdf-parse');
  const uint8 = new Uint8Array(buffer);
  const pdf = new PDFParse(uint8);
  const result = await pdf.getText();
  
  if (!result.pages || result.pages.length === 0) {
    return [{
      nodeType: 'page',
      identifier: 'Page 1',
      rawText: result.text || '',
      textPreview: (result.text || '').substring(0, 1500)
    }];
  }

  return result.pages.map(p => ({
    nodeType: 'page',
    identifier: `Page ${p.num}`,
    rawText: p.text || '',
    textPreview: (p.text || '').substring(0, 1500)
  }));
}


// Helper: Parse Excel worksheets into nodes (lazy-loaded to avoid Vercel startup crash)
async function parseExcelSheets(buffer) {
  const xlsx = require('xlsx');
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

// Health check (no auth required) - use to verify Vercel function is running
app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: !!process.env.SUPABASE_URL, ts: Date.now() });
});

// 1. Secure Upload Preparation Endpoint
app.post('/api/prepare-upload', requireAuth, async (req, res) => {

  try {
    const { filename, mimeType, clientId } = req.body;
    if (!filename || !clientId) {
      return res.status(400).json({ error: 'Missing filename or clientId' });
    }

    if (clientId !== req.auth.user.id) {
      return res.status(403).json({ error: 'clientId must match the authenticated user' });
    }
    
    const timestamp = Date.now();
    const safeFilename = sanitizeStorageFilename(filename);
    const storagePath = `${clientId}/${timestamp}_${safeFilename}`;
    
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
app.post('/api/create-batch', requireAuth, async (req, res) => {
  try {
    const { clientId, excelPath, supportPaths, processingMode } = req.body;
    
    if (!excelPath || !clientId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    if (clientId !== req.auth.user.id) {
      return res.status(403).json({ error: 'clientId must match the authenticated user' });
    }

    const paths = [excelPath, ...(Array.isArray(supportPaths) ? supportPaths : [])];
    if (paths.some((path) => !String(path).startsWith(`${clientId}/`))) {
      return res.status(403).json({ error: 'All file paths must belong to the authenticated user' });
    }

    const supportFilePaths = Array.isArray(supportPaths) ? supportPaths : [];
    
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
    for (const path of supportFilePaths) {
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
    
    const runProcessing = async () => {
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
        console.log(`Building secure PageTreeIndex for ${supportFilePaths.length} supporting documents...`);
        let supportNodes = [];

        for (const path of supportFilePaths) {
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

        // Generate metadata summaries with smart file-level caching to prevent rate limits and timeouts
        console.log(`Indexing ${supportNodes.length} decrypted document pages/sheets using Llama 3.1 8B with file-level caching...`);
        const fileMetadataCache = {};
        for (let i = 0; i < supportNodes.length; i++) {
          const node = supportNodes[i];
          const cacheKey = node.fileName;
          
          if (fileMetadataCache[cacheKey]) {
            node.metadata = fileMetadataCache[cacheKey];
          } else {
            console.log(`Generating fresh metadata for unique file: ${cacheKey} (using ${node.identifier})`);
            node.metadata = await generateNodeMetadata(node);
            fileMetadataCache[cacheKey] = node.metadata;
            await sleep(400); // 400ms delay between unique files to avoid rate limits
          }
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
            const navigationPrompt = `You are a professional CA audit document navigation assistant. Given one dump row and a PageTreeIndex of supporting documents, identify all pages/sheets needed to vouch every relevant parameter, not only amount and vendor.

TRANSACTION TO AUDIT:
${JSON.stringify(txn, null, 2)}

SUPPORTING DOCUMENTS INDEX (PageTreeIndex):
${JSON.stringify(pageTreeIndex, null, 2)}

INSTRUCTIONS:
1. Search for vendor/bank/counterparty, amount, date, value date, maturity date, invoice number, account number, FDR number, UTR/reference number, PO/GRN, narration, tax/GST, and any other dump column.
2. Include corroborating email receipts, approval mails, bank advices, FDR files, invoices, and spreadsheets when they support the same transaction.
3. For fixed deposits, include both the FDR/advice page and any email receipt/approval that confirms placement, bank, principal, date, maturity, rate, or reference.
4. Output a list of indexId numbers for all candidate pages/sheets needed for expert vouching.
5. Return ONLY a raw JSON array of integers. Do not write code or text.
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
            const amountKey = keys.find(k => k.toLowerCase().includes('amt') || k.toLowerCase().includes('amount') || k.toLowerCase().includes('val') || k.toLowerCase().includes('price')) || keys[keys.length - 1];
            
            const amountQuery = String(txn[amountKey] || '');
            const meaningfulValues = Object.values(txn)
              .map(value => String(value || '').toLowerCase().trim())
              .filter(value => value.length >= 3)
              .flatMap(value => value.split(/[\s,;/|]+/).filter(part => part.length >= 3));
            
            candidateIndices = pageTreeIndex.filter(p => {
              const vName = (p.vendorName || '').toLowerCase();
              const summary = (p.summary || '').toLowerCase();
              const docType = (p.documentType || '').toLowerCase();
              const fName = (p.fileName || '').toLowerCase();
              const invoice = (p.invoiceNumber || '').toLowerCase();
              
              const amountMatch = amountQuery && (summary.includes(amountQuery) || String(p.totalAmount).includes(amountQuery));
              const fieldMatch = meaningfulValues.some(value =>
                vName.includes(value) ||
                summary.includes(value) ||
                fName.includes(value) ||
                invoice.includes(value) ||
                docType.includes(value)
              );
              
              return amountMatch || fieldMatch;
            }).map(p => p.indexId);
            
            if (candidateIndices.length === 0 && supportNodes.length > 0) {
              candidateIndices = [0];
            }
          }

          // Step 2: Fetch detailed raw contents for candidate nodes
          const candidateDocsContent = candidateIndices.map(id => {
            const node = supportNodes[id];
            return `--- File: ${node.fileName} | ${node.identifier} ---\n${node.rawText}`;
          }).join('\n\n');
          const candidateNodes = candidateIndices.map(id => supportNodes[id]).filter(Boolean);

          // Step 3: Column-by-column reconciliation & audit matching
          try {
            const reconciliationPrompt = `You are an expert Chartered Accountant performing a detailed statutory audit vouching procedure. Reconcile the transaction dump row against the selected supporting documents exactly as a senior CA would: inspect every material parameter independently, cite the precise evidence, and conclude whether the transaction is vouched.

TRANSACTION DUMP ROW TO VOUCH:
${JSON.stringify(txn, null, 2)}

SUPPORTING DOCUMENT DETAILS:
${candidateDocsContent}

AUDITING INSTRUCTIONS:
Perform a strict parameter-by-parameter reconciliation for every relevant dump column and every audit assertion:
1. Counterparty/vendor/bank/customer name.
2. Amount/principal/tax/total and currency.
3. Transaction date, document date, value date, maturity date, due date, or receipt date.
4. Invoice number, FDR number, UTR, cheque number, account number, PO/GRN, contract number, or other references.
5. Narration/description/purpose and document type.
6. For FDR/fixed deposit transactions, compare the FDR/advice with mail receipts or approval emails and confirm bank, principal, FDR/reference number, placement/value date, maturity date, rate, and maturity value when available.
7. For invoice/receipt transactions, compare invoice/receipt/e-mail/ledger support and identify the exact IDs used.
8. If a parameter is not applicable, mark it "not_applicable"; if support is missing, mark it "missing"; if conflicting, mark it "mismatched".
9. Do not mark the transaction matched only because amount and vendor match. Overall status must reflect all important parameters.

DETERMINE STATUS & CONFIDENCE:
- "matched": all material parameters are matched or properly not applicable.
- "mismatched": any material parameter conflicts with supporting evidence.
- "flagged": evidence is missing, inconclusive, or not enough to complete vouching.
- Confidence should be based on the proportion and importance of matched parameters, not just amount/vendor.

Return ONLY a raw JSON object matching the following structure. No markdown code blocks, no conversational text.
{
  "transaction_id": "<dump transaction id/reference>",
  "vendor": "<inferred vendor>",
  "amount_doc": <numeric amount or 0>,
  "confidence": <confidence score 0.0 to 1.0>,
  "status": "matched" | "mismatched" | "flagged",
  "reference_numbers": ["<invoice/FDR/UTR/account/reference numbers actually used>"],
  "evidence_files": ["<filename and page/sheet used>"],
  "parameter_matches": [
    {
      "parameter": "<dump column or audit assertion>",
      "dump_value": "<value from dump>",
      "evidence_value": "<value found in support>",
      "status": "matched" | "mismatched" | "missing" | "not_applicable",
      "source_file": "<exact filename>",
      "source_section": "<page/sheet>",
      "reference_number": "<invoice/FDR/UTR/account/reference if used>",
      "explanation": "<brief CA-style reasoning>"
    }
  ],
  "auditor_notes": "<CA-style conclusion citing exact files, sections, IDs/reference numbers, and unresolved issues.>"
}`;

            const modelName = "meta/llama-3.1-8b-instruct";
            const auditResponse = await retryOpenAICall(async () => {
              return await openai.chat.completions.create({
                model: modelName,
                messages: [{ role: "user", content: reconciliationPrompt }],
                temperature: 0.05,
                max_tokens: 1800,
              });
            });
            await sleep(300); // rate limit padding spacing

            const auditText = auditResponse.choices[0].message.content.trim();
            const auditResult = parseRobustJSON(auditText);

            finalVouchingResults.push(normalizeAuditResult(auditResult, txn, allHeaders, candidateNodes));

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
              auditor_notes: `Flagged: Internal error during audit verification: ${auditErr.message}`,
              match_details: [],
              evidence_files: candidateNodes.map((node) => `${node.fileName} (${node.identifier})`),
              reference_numbers: []
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
          auditor_notes: encryptText(r.auditor_notes),
          match_details: encryptText(JSON.stringify(r.match_details || [])),
          evidence_files: encryptText(JSON.stringify(r.evidence_files || [])),
          reference_numbers: encryptText(JSON.stringify(r.reference_numbers || []))
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
    };

    if (process.env.VERCEL) {
      console.log(`VERCEL ENVIRONMENT DETECTED: Running vouching process synchronously in request lifecycle to avoid background thread freezing.`);
      await runProcessing();
      res.json({ message: 'Secure batch created and processing completed', batchId: dbBatchId });
    } else {
      console.log(`LOCAL ENVIRONMENT DETECTED: Running vouching process asynchronously in background thread.`);
      res.json({ message: 'Secure batch created and processing started', batchId: dbBatchId });
      setTimeout(runProcessing, 0);
    }

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Batches Listing API (with metadata decryption)
app.get('/api/batches', requireAuth, async (req, res) => {
  try {
    const { userId } = req.query;
    let query = supabase.from('batches').select('*');
    if (userId) {
      if (!canAccessUser(req, userId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      query = query.eq('user_id', userId);
    } else if (!['admin', 'auditor'].includes(req.auth.role)) {
      query = query.eq('user_id', req.auth.user.id);
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
app.get('/api/batches/:id/results', requireAuth, requireBatchAccess, async (req, res) => {
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
      match_details: parseEncryptedJSONField(r.match_details, []),
      evidence_files: parseEncryptedJSONField(r.evidence_files, []),
      reference_numbers: parseEncryptedJSONField(r.reference_numbers, []),
      created_at: r.created_at
    }));
    
    res.json(decryptedResults);
  } catch (err) {
    console.error("Fetch batch results error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Secure Decrypted Document Streaming Endpoint
app.get('/api/batches/:id/document', requireAuth, requireBatchAccess, async (req, res) => {
  try {
    const { path: filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: "Missing document path" });
    }

    const { data: matchingDoc, error: docLookupError } = await supabase
      .from('documents')
      .select('id')
      .eq('batch_id', req.batch.id)
      .eq('file_url', filePath)
      .maybeSingle();

    if (docLookupError) throw docLookupError;

    const isBatchExcel = filePath === req.batch.file_url;
    if (!isBatchExcel && !matchingDoc) {
      return res.status(403).json({ error: 'Document is not part of this batch' });
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
app.post('/api/results/:id/override', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, auditor_notes } = req.body;

    const allowedStatuses = ['matched', 'mismatched', 'flagged', 'manually_resolved'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status parameter" });
    }

    const { data: existingResult, error: resultLookupError } = await supabase
      .from('vouching_results')
      .select('id, batch_id, batches!inner(user_id)')
      .eq('id', id)
      .single();

    if (resultLookupError || !existingResult) {
      return res.status(404).json({ error: 'Result not found' });
    }

    if (!canAccessUser(req, existingResult.batches.user_id)) {
      return res.status(403).json({ error: 'Forbidden' });
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
        auditor_notes: decryptText(data.auditor_notes),
        match_details: parseEncryptedJSONField(data.match_details, []),
        evidence_files: parseEncryptedJSONField(data.evidence_files, []),
        reference_numbers: parseEncryptedJSONField(data.reference_numbers, [])
      }
    });

  } catch (err) {
    console.error("Override result error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI Secure Zero-Trust Auditing Engine running on port ${PORT}`);
  });
}

module.exports = app;
