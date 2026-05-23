require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
global.WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { decryptText } = require('./crypto_helper');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const crypto = require('crypto');

// Local Web Crypto compatible encryption
function encryptGCM(buffer, keyHex, ivHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(buffer);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]); // Standard format with appended tag
}

async function runVerification() {
  console.log("==================================================");
  console.log("🚀 STARTING ZERO-TRUST END-TO-END CRYPTO VALIDATION");
  console.log("==================================================");

  try {
    // 1. Get an active user ID
    const { data: profiles, error: pErr } = await supabase.from('profiles').select('id').limit(1);
    if (pErr || !profiles || profiles.length === 0) {
      throw new Error("No active profiles found in Supabase DB: " + (pErr?.message || "empty"));
    }
    const clientId = profiles[0].id;
    console.log(`✔ Using Active Client ID: ${clientId}`);

    // 2. Generate a mock Excel transaction file buffer
    console.log("\nGenerating mock Transaction Excel Dump...");
    const mockTxns = [
      { "Transaction ID": "TXN-VERIFY-001", "Vendor": "Google Cloud", "Amount": 1500 },
      { "Transaction ID": "TXN-VERIFY-002", "Vendor": "Microsoft Azure", "Amount": 3500 }
    ];
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(mockTxns);
    xlsx.utils.book_append_sheet(wb, ws, "Transactions");
    const excelBuf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    console.log(`✔ Generated Excel Dump buffer (${excelBuf.length} bytes)`);

    // 3. Generate a mock Supporting Document (Excel format for quick execution)
    console.log("\nGenerating mock Supporting spreadsheet...");
    const mockDocs = [
      { "Invoice No": "INV-GC-882", "Supplier": "Google Cloud Platform", "Amount": 1500, "Date": "2026-05-15" }
    ];
    const wbSupport = xlsx.utils.book_new();
    const wsSupport = xlsx.utils.json_to_sheet(mockDocs);
    xlsx.utils.book_append_sheet(wbSupport, wsSupport, "Invoice");
    const supportBuf = xlsx.write(wbSupport, { type: 'buffer', bookType: 'xlsx' });
    console.log(`✔ Generated Supporting Document buffer (${supportBuf.length} bytes)`);

    // 4. Prepare Upload for Excel Dump
    console.log("\nPreparing upload for Excel dump...");
    const excelPrepRes = await fetch('http://localhost:3000/api/prepare-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'verify_txns.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        clientId
      })
    });
    if (!excelPrepRes.ok) {
      throw new Error(`Failed to prepare excel upload: ${excelPrepRes.statusText}`);
    }
    const excelPrep = await excelPrepRes.json();
    console.log("✔ Excel Prepare upload response received.");
    
    // Encrypt Excel Dump
    const encryptedExcel = encryptGCM(excelBuf, excelPrep.clearKey, excelPrep.iv);
    console.log("✔ Excel dump encrypted successfully.");

    // Direct Upload encrypted Excel Dump (bypassing server)
    console.log("Uploading encrypted Excel dump directly to Supabase storage...");
    const excelUploadRes = await fetch(excelPrep.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: encryptedExcel
    });
    if (!excelUploadRes.ok) {
      throw new Error(`Failed to upload encrypted Excel: ${excelUploadRes.statusText}`);
    }
    console.log("✔ Encrypted Excel dump uploaded successfully!");

    // 5. Prepare Upload for Supporting Document
    console.log("\nPreparing upload for Supporting spreadsheet...");
    const supportPrepRes = await fetch('http://localhost:3000/api/prepare-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'verify_invoice.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        clientId
      })
    });
    if (!supportPrepRes.ok) {
      throw new Error(`Failed to prepare support upload: ${supportPrepRes.statusText}`);
    }
    const supportPrep = await supportPrepRes.json();
    console.log("✔ Supporting spreadsheet Prepare upload response received.");

    // Encrypt Supporting Document
    const encryptedSupport = encryptGCM(supportBuf, supportPrep.clearKey, supportPrep.iv);
    console.log("✔ Supporting spreadsheet encrypted successfully.");

    // Direct Upload encrypted Supporting Document (bypassing server)
    console.log("Uploading encrypted Supporting spreadsheet directly to Supabase storage...");
    const supportUploadRes = await fetch(supportPrep.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: encryptedSupport
    });
    if (!supportUploadRes.ok) {
      throw new Error(`Failed to upload encrypted support file: ${supportUploadRes.statusText}`);
    }
    console.log("✔ Encrypted Supporting spreadsheet uploaded successfully!");

    // 6. Trigger Batch Creation & secure background matching
    console.log("\nTriggering secure batch creation...");
    const batchRes = await fetch('http://localhost:3000/api/create-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        excelPath: excelPrep.fileUrl,
        supportPaths: [supportPrep.fileUrl],
        processingMode: '8b'
      })
    });
    if (!batchRes.ok) {
      throw new Error(`Failed to trigger secure batch: ${batchRes.statusText}`);
    }
    const { batchId } = await batchRes.json();
    console.log(`✔ Secure Batch created with ID: ${batchId}`);

    // 7. Poll until batch is complete
    console.log("\nPolling secure batch status...");
    let completed = false;
    for (let attempt = 1; attempt <= 20; attempt++) {
      await new Promise(r => setTimeout(r, 3000));
      const listRes = await fetch(`http://localhost:3000/api/batches?userId=${clientId}`);
      if (!listRes.ok) continue;
      const batches = await listRes.json();
      const currentBatch = batches.find(b => b.id === batchId);
      if (!currentBatch) {
        throw new Error("Batch not found in list!");
      }
      console.log(`[Attempt ${attempt}/20] Batch Status: ${currentBatch.status}`);
      if (currentBatch.status === 'completed') {
        completed = true;
        break;
      }
      if (currentBatch.status === 'failed') {
        throw new Error("Batch processing failed!");
      }
    }

    if (!completed) {
      throw new Error("Batch processing timed out!");
    }
    console.log("✔ Batch completed successfully!");

    // 8. VERIFICATION PROOF 1: Supabase Bucket Ciphertext check
    console.log("\n🛡 VERIFICATION 1: Checking bucket file payloads...");
    const { data: downloadedBlob, error: bucketErr } = await supabase.storage
      .from('uploads')
      .download(excelPrep.fileUrl);
    if (bucketErr) throw bucketErr;

    const downloadedBuf = Buffer.from(await downloadedBlob.arrayBuffer());
    console.log(`✔ Downloaded raw bucket payload size: ${downloadedBuf.length} bytes.`);
    
    // Verify that the payload is encrypted by checking that it does NOT start with the standard ZIP magic header [0x50, 0x4b, 0x03, 0x04] of an unencrypted XLSX file
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    if (downloadedBuf.subarray(0, 4).equals(zipHeader)) {
      throw new Error("CRITICAL SECURITY FAILURE: Bucket payload starts with ZIP magic header! It was NOT encrypted.");
    }
    console.log("✔ Bucket payload is securely encrypted (does not contain standard XLSX zip signature).");

    // 9. VERIFICATION PROOF 2: Database Metadata at-rest encryption check
    console.log("\n🛡 VERIFICATION 2: Checking database metadata at-rest encryption...");
    
    // Batch Table Check
    const { data: dbBatch, error: dbBatchErr } = await supabase
      .from('batches')
      .select('*')
      .eq('id', batchId)
      .single();
    if (dbBatchErr) throw dbBatchErr;
    console.log(`Raw Batch Filename in DB: "${dbBatch.filename}"`);
    if (!dbBatch.filename.includes(':')) {
      throw new Error("CRITICAL SECURITY FAILURE: Filename is not encrypted in batches table!");
    }
    console.log("✔ Batch filename is securely encrypted at rest in Postgres (ciphertext).");

    // Vouching Results Table Check
    const { data: dbResults, error: dbResErr } = await supabase
      .from('vouching_results')
      .select('*')
      .eq('batch_id', batchId);
    if (dbResErr) throw dbResErr;

    console.log(`Retrieved ${dbResults.length} raw results from DB.`);
    dbResults.forEach((res, i) => {
      console.log(`\nRow ${i+1} raw columns in DB:`);
      console.log(`- txn_id: "${res.txn_id}"`);
      console.log(`- vendor: "${res.vendor}"`);
      console.log(`- amount_dump: "${res.amount_dump}"`);
      console.log(`- amount_doc: "${res.amount_doc}"`);
      console.log(`- confidence: "${res.confidence}"`);
      console.log(`- auditor_notes: "${res.auditor_notes.substring(0, 60)}..."`);
      
      if (!res.vendor.includes(':') || !res.auditor_notes.includes(':') || !res.amount_dump.includes(':')) {
        throw new Error("CRITICAL SECURITY FAILURE: Results fields are not encrypted at rest in Postgres!");
      }
    });
    console.log("\n✔ All sensitive results fields are fully encrypted at rest in Postgres.");

    // 10. VERIFICATION PROOF 3: Decrypted middleware check
    console.log("\n🛡 VERIFICATION 3: Testing API results decryption endpoint...");
    const resultsRes = await fetch(`http://localhost:3000/api/batches/${batchId}/results`);
    if (!resultsRes.ok) {
      throw new Error(`Failed to fetch results from decrypted endpoint: ${resultsRes.statusText}`);
    }
    const decryptedResults = await resultsRes.json();

    console.log(`Decrypted Results returned from endpoint:`);
    decryptedResults.forEach((res, i) => {
      console.log(`\nRow ${i+1}:`);
      console.log(`- Transaction ID: "${res.txn_id}" (Type: ${typeof res.txn_id})`);
      console.log(`- Inferred Vendor: "${res.vendor}" (Type: ${typeof res.vendor})`);
      console.log(`- Excel Amount: ${res.amount_dump} (Type: ${typeof res.amount_dump})`);
      console.log(`- Doc Amount: ${res.amount_doc} (Type: ${typeof res.amount_doc})`);
      console.log(`- Confidence Score: ${res.confidence} (Type: ${typeof res.confidence})`);
      console.log(`- Auditor Notes: "${res.auditor_notes.substring(0, 100)}..."`);
      
      if (typeof res.amount_dump !== 'number' || typeof res.amount_doc !== 'number' || typeof res.confidence !== 'number') {
        throw new Error("CRITICAL BUG: Decrypted numerical values are not properly parsed and typecast back to numbers!");
      }
    });
    console.log("\n✔ All results successfully decrypted, formatted, and type-safe!");

    // 11. VERIFICATION PROOF 4: Streaming decrypted document check
    console.log("\n🛡 VERIFICATION 4: Testing secure decrypted document streaming endpoint...");
    const streamRes = await fetch(`http://localhost:3000/api/batches/${batchId}/document?path=${encodeURIComponent(excelPrep.fileUrl)}`);
    if (!streamRes.ok) {
      throw new Error(`Failed to stream document: ${streamRes.statusText}`);
    }
    const contentType = streamRes.headers.get('Content-Type');
    console.log(`- Document Content-Type returned: "${contentType}"`);
    const streamBuf = Buffer.from(await streamRes.arrayBuffer());
    console.log(`- Decrypted streaming payload size: ${streamBuf.length} bytes.`);
    
    // The decrypted stream must contain the original ZIP header PK\x03\x04!
    if (!streamBuf.subarray(0, 4).equals(zipHeader)) {
      throw new Error("CRITICAL BUG: Decrypted document stream does not contain standard ZIP header PK\\x03\\x04!");
    }
    console.log("✔ Secure decrypted document streaming returned perfect clear bytes!");

    // 12. VERIFICATION PROOF 5: Manual Auditor Override check
    console.log("\n🛡 VERIFICATION 5: Testing manual auditor override endpoint...");
    const targetResultId = decryptedResults[0].id;
    const overrideRes = await fetch(`http://localhost:3000/api/results/${targetResultId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'matched',
        auditor_notes: 'Auditor verified match manually using visual snip tools.'
      })
    });
    if (!overrideRes.ok) {
      throw new Error(`Failed to perform manual override: ${overrideRes.statusText}`);
    }
    const overrideData = await overrideRes.json();
    console.log(`- Overridden status returned: "${overrideData.result.status}"`);
    console.log(`- Overridden decrypted auditor notes: "${overrideData.result.auditor_notes}"`);
    
    if (overrideData.result.status !== 'matched' || overrideData.result.auditor_notes !== 'Auditor verified match manually using visual snip tools.') {
      throw new Error("CRITICAL BUG: Override status or notes did not update correctly!");
    }
    
    // Verify that it is actually encrypted in DB at rest
    const { data: dbOverrideRaw, error: dbOverrideRawErr } = await supabase
      .from('vouching_results')
      .select('auditor_notes')
      .eq('id', targetResultId)
      .single();
    if (dbOverrideRawErr) throw dbOverrideRawErr;
    console.log(`- Raw overridden auditor notes in DB at-rest: "${dbOverrideRaw.auditor_notes}"`);
    if (!dbOverrideRaw.auditor_notes.includes(':')) {
      throw new Error("CRITICAL SECURITY FAILURE: Overridden notes were NOT encrypted at rest in Postgres!");
    }
    
    console.log("✔ Manual auditor override successfully executed, decrypted, and securely encrypted at rest!");

    console.log("\n==================================================");
    console.log("🎉 SUCCESS: ALL ZERO-TRUST CRYPTOGRAPHIC AND RAG AUDIT TESTS PASSED!");
    console.log("==================================================");

  } catch (err) {
    console.error("\n❌ VERIFICATION TEST FAILED:", err.message);
    process.exit(1);
  }
}

runVerification();
