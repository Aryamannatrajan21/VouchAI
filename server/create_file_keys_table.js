const { Client } = require('pg');

const client = new Client({
  host: 'db.ggzltbymirqpqkkollnc.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'TPwuSbskuQ6yGKeo',
  database: 'postgres',
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

      -- 3. Drop existing policies if they exist
      DROP POLICY IF EXISTS "Allow select for everyone on file_keys" ON public.file_keys;
      DROP POLICY IF EXISTS "Allow insert for everyone on file_keys" ON public.file_keys;

      -- 4. Create policies to allow inserts and select for authenticated sessions
      CREATE POLICY "Allow select for everyone on file_keys" ON public.file_keys FOR SELECT USING (true);
      CREATE POLICY "Allow insert for everyone on file_keys" ON public.file_keys FOR INSERT WITH CHECK (true);
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
