const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  try {
    const sql = `
      -- 1. Create file_keys table to map encrypted files to their wrapped keys & IVs
      CREATE TABLE IF NOT EXISTS public.file_keys (
        id uuid default uuid_generate_v4() primary key,
        file_url text not null unique,
        wrapped_key text not null,
        iv text not null,
        created_at timestamp with time zone default timezone('utc'::text, now()) not null
      );

      -- 2. Enable row level security
      ALTER TABLE public.file_keys ENABLE ROW LEVEL SECURITY;

      -- 3. Drop permissive policies if they exist. The service role bypasses RLS.
      DROP POLICY IF EXISTS "Allow select for everyone on file_keys" ON public.file_keys;
      DROP POLICY IF EXISTS "Allow insert for everyone on file_keys" ON public.file_keys;
    `;
    await client.query(sql);
    console.log('Successfully created public.file_keys table with secure RLS policies!');
  } catch (err) {
    console.error('Error creating file_keys table:', err);
  } finally {
    await client.end();
  }
}

run();
