require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const multer = require('multer');

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

// Helper: convert an array of objects into a clean markdown table string
function toMarkdownTable(rows) {
  if (!rows || rows.length === 0) return '(empty)';
  const headers = Object.keys(rows[0]);
  const divider = headers.map(h => '-'.repeat(Math.max(h.length, 6))).join(' | ');
  const headerRow = headers.join(' | ');
  const dataRows = rows.map(r => headers.map(h => String(r[h] ?? '')).join(' | '));
  return [headerRow, divider, ...dataRows].join('\n');
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
        console.log(`Starting AI processing for batch ${dbBatchId}...`);
        
        // Determine AI model to use
        const isTurbo = processingMode === '8b';
        const modelName = isTurbo ? "meta/llama-3.1-8b-instruct" : "meta/llama-3.3-70b-instruct";
        console.log(`Using AI Model: ${modelName} (Turbo: ${isTurbo})`);

        // 2. Download and Parse Excel Dump
        const { data: excelBlob, error: downloadError } = await supabase.storage.from('uploads').download(excelPath);
        if (downloadError) throw downloadError;

        const arrayBuffer = await excelBlob.arrayBuffer();
        const xlsx = require('xlsx');
        const workbook = xlsx.read(arrayBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const allRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        console.log(`Extracted ${allRows.length} rows from Excel dump.`);

        if (allRows.length === 0) {
          throw new Error('No transactions found in the Excel dump. Please check the file format.');
        }

        // Use column mapping to build structured transaction objects
        const txnIdCol = columnMapping?.txnId;
        const vendorCol = columnMapping?.vendor;
        const amountCol = columnMapping?.amount;

        const transactions = allRows.slice(0, 25).map((row, idx) => ({
          txn_id: String(row[txnIdCol] ?? idx + 1),
          vendor: String(row[vendorCol] ?? 'Unknown'),
          amount: Number(row[amountCol]) || 0,
          raw: row  // keep all columns for context
        }));
        console.log(`Structured ${transactions.length} transactions using mapping: ID=${txnIdCol}, Vendor=${vendorCol}, Amount=${amountCol}`);

        // 3. Download and Parse Support Docs — format as readable markdown tables
        let supportSections = [];
        for (const path of supportPaths) {
          const { data: supportBlob } = await supabase.storage.from('uploads').download(path);
          if (!supportBlob) continue;
          const fileName = path.split('/').pop();
          const ext = path.split('.').pop().toLowerCase();
          if (['xlsx','csv','xls','xlsm','xlsb'].includes(ext)) {
            const buf = await supportBlob.arrayBuffer();
            const wb = xlsx.read(buf, { type: 'buffer' });
            // Parse ALL sheets
            for (const sName of wb.SheetNames) {
              const rows = xlsx.utils.sheet_to_json(wb.Sheets[sName]);
              if (rows.length > 0) {
                supportSections.push(`--- File: ${fileName} | Sheet: ${sName} ---\n${toMarkdownTable(rows.slice(0, 50))}`);
              }
            }
          } else {
            supportSections.push(`--- File: ${fileName} ---\n[Non-spreadsheet file — manual review required]`);
          }
        }

        const supportText = supportSections.length > 0
          ? supportSections.join('\n\n')
          : 'No supporting documents provided.';

        console.log(`Support document text length: ${supportText.length} chars.`);

        // 4. Build structured, explicit prompt
        const txnTable = transactions.map(t =>
          `- txn_id: "${t.txn_id}" | vendor: "${t.vendor}" | amount: ${t.amount}`
        ).join('\n');

        const prompt = `You are an expert financial auditor AI. Your task is to match each transaction from the TRANSACTION DUMP against the SUPPORTING DOCUMENTS to verify if each transaction is correct.

COLUMN MAPPING (how the transaction dump is structured):
- Transaction ID is in column: "${txnIdCol}"
- Vendor / Party name is in column: "${vendorCol}"
- Amount is in column: "${amountCol}"

TRANSACTION DUMP (${transactions.length} transactions):
${txnTable}

SUPPORTING DOCUMENTS:
${supportText}

INSTRUCTIONS:
1. For EACH transaction, search the supporting documents for a row where the vendor name and amount match.
2. Compare the amount in the dump vs the amount found in the supporting document.
3. If amounts match exactly → status: "matched", confidence: 0.95–1.0
4. If amounts differ → status: "mismatched", confidence: 0.5–0.7, note the difference
5. If no matching record found → status: "flagged", confidence: 0.0–0.3, explain what was searched
6. Return ONLY a raw JSON array. No markdown, no explanation, no extra text.

JSON FORMAT (one object per transaction, exactly ${transactions.length} objects):
[{ "txn_id": "string", "vendor": "string", "amount_dump": number, "amount_doc": number, "confidence": number, "status": "matched"|"mismatched"|"flagged", "auditor_notes": "string" }]`;

        console.log(`Prompt length: ${prompt.length} chars.`);

        const completion = await openai.chat.completions.create({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.05,
          max_tokens: 4096,
        });

        let aiResultText = completion.choices[0].message.content.trim();
        console.log(`AI Raw Output:`, aiResultText);
        let aiResults = [];
        try {
          // Robustly extract JSON Array from text to ignore conversational prefixes/suffixes & multiple arrays
          let parsedData = null;
          const arrayRegex = /\[[\s\S]*?\]/g;
          let match;
          
          while ((match = arrayRegex.exec(aiResultText)) !== null) {
            try {
              const parsed = JSON.parse(match[0]);
              if (Array.isArray(parsed) && parsed.length > 0) {
                parsedData = parsed;
                break; // Found a valid JSON array!
              }
            } catch (err) {
              // Ignore single block parse error and check next match
            }
          }

          if (parsedData) {
            aiResults = parsedData;
          } else {
            // Fallback to absolute boundaries
            const start = aiResultText.indexOf('[');
            const end = aiResultText.lastIndexOf(']');
            if (start !== -1 && end !== -1 && end > start) {
              const jsonStr = aiResultText.substring(start, end + 1);
              aiResults = JSON.parse(jsonStr);
            } else {
              // Final fallback
              aiResults = JSON.parse(aiResultText);
            }
          }
          if (!Array.isArray(aiResults)) aiResults = [aiResults];
        } catch (e) {
          console.error("Failed to parse AI JSON:", aiResultText);
          throw new Error("AI returned invalid JSON format");
        }

        // 5. Save Results to DB
        const resultsToInsert = aiResults.map(r => ({
          batch_id: dbBatchId,
          txn_id: r.txn_id || 'UNKNOWN',
          vendor: r.vendor || 'UNKNOWN',
          amount_dump: r.amount_dump || 0,
          amount_doc: r.amount_doc || 0,
          confidence: r.confidence || 0,
          status: r.status || 'flagged'
        }));

        await supabase.from('vouching_results').insert(resultsToInsert);
        await supabase.from('batches').update({ status: 'completed' }).eq('id', dbBatchId);
        
        console.log(`Batch ${dbBatchId} completed successfully!`);
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
