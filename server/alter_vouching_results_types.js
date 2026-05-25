const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  try {
    const sql = `
      -- 1. Alter vouching_results columns to text to allow storing encrypted ciphertexts
      ALTER TABLE public.vouching_results 
        ALTER COLUMN amount_dump TYPE text USING amount_dump::text,
        ALTER COLUMN amount_doc TYPE text USING amount_doc::text,
        ALTER COLUMN confidence TYPE text USING confidence::text;

      ALTER TABLE public.vouching_results
        ADD COLUMN IF NOT EXISTS match_details text,
        ADD COLUMN IF NOT EXISTS evidence_files text,
        ADD COLUMN IF NOT EXISTS reference_numbers text;
        
      console_log('Successfully altered columns to text!');
    `;
    // We execute pg alter queries
    await client.query(`
      ALTER TABLE public.vouching_results 
        ALTER COLUMN amount_dump TYPE text USING amount_dump::text,
        ALTER COLUMN amount_doc TYPE text USING amount_doc::text,
        ALTER COLUMN confidence TYPE text USING confidence::text;
      ALTER TABLE public.vouching_results
        ADD COLUMN IF NOT EXISTS match_details text,
        ADD COLUMN IF NOT EXISTS evidence_files text,
        ADD COLUMN IF NOT EXISTS reference_numbers text;
    `);
    console.log('Successfully altered vouching_results column types to TEXT to support encryption!');
  } catch (err) {
    console.error('Error altering column types:', err);
  } finally {
    await client.end();
  }
}

run();
