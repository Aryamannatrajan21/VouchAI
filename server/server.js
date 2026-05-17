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

// Endpoint to process a batch
app.post('/api/process-batch', async (req, res) => {
  try {
    const { excelPath, supportPaths, clientId, processingMode } = req.body;
    
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
        const modelName = isTurbo ? "meta/llama-3.1-8b-instruct" : "meta/llama-3.1-70b-instruct";
        console.log(`Using AI Model: ${modelName} (Turbo: ${isTurbo})`);

        // 2. Download and Parse Excel
        const { data: excelBlob, error: downloadError } = await supabase.storage.from('uploads').download(excelPath);
        if (downloadError) throw downloadError;
        
        const arrayBuffer = await excelBlob.arrayBuffer();
        const xlsx = require('xlsx');
        const workbook = xlsx.read(arrayBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const transactions = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        console.log(`Extracted ${transactions.length} transactions from Excel dump.`);
        
        if (transactions.length === 0) {
          throw new Error('No transactions found in the Excel dump. Please check the file format.');
        }

        // 3. Download and Parse Support Docs (Mocking PDF/Image extraction for simplicity, using text from Excel if provided)
        let supportText = '';
        for (const path of supportPaths) {
           const { data: supportBlob } = await supabase.storage.from('uploads').download(path);
           if (supportBlob) {
             if (path.endsWith('.xlsx') || path.endsWith('.csv') || path.endsWith('.xls') || path.endsWith('.xlsm') || path.endsWith('.xlsb')) {
               const buf = await supportBlob.arrayBuffer();
               const wb = xlsx.read(buf, { type: 'buffer' });
               supportText += JSON.stringify(xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])) + '\n';
             } else {
               // If PDF, we'd use pdf-parse here. For prototype, we just note it.
               supportText += `[Content of document ${path} would be parsed here]\n`;
             }
           }
        }
        
        console.log(`Extracted support documents text. Length: ${supportText.length} chars.`);

        // 4. Call Nvidia API
        const prompt = `
You are an expert AI Auditor. Your job is to reconcile the transactions provided in the "Transactions JSON" against the "Support Documents Data".

Transactions JSON:
${JSON.stringify(transactions.slice(0, 10))} // Limiting to 10 for prototype

Support Documents Data:
${supportText}

INSTRUCTIONS:
1. You MUST return exactly one JSON object for EVERY transaction in the Transactions JSON.
2. If you cannot find the supporting document, set status to 'flagged' and explain why in 'auditor_notes'.
3. Output a strictly formatted JSON array of objects. Do NOT wrap in markdown.
Format per object:
{ "txn_id": "string", "vendor": "string", "amount_dump": number, "amount_doc": number, "confidence": number, "status": "matched" | "mismatched" | "flagged", "auditor_notes": "string" }
        `;

        const completion = await openai.chat.completions.create({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 1024,
        });

        let aiResultText = completion.choices[0].message.content.trim();
        // Strip markdown code blocks if any
        if (aiResultText.startsWith('```json')) aiResultText = aiResultText.replace(/```json/g, '').replace(/```/g, '').trim();
        if (aiResultText.startsWith('```')) aiResultText = aiResultText.replace(/```/g, '').trim();
        
        console.log(`AI Raw Output:`, aiResultText);
        let aiResults = [];
        try {
          aiResults = JSON.parse(aiResultText);
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
        await supabase.from('batches').update({ status: 'failed' }).eq('id', dbBatchId).catch(() => {});
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
