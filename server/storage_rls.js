const { createClient } = require('@supabase/supabase-js');
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
  try {
    await client.connect();
    
    // Create RLS policies for storage.objects
    const sql = `
      DO $$
      BEGIN
          IF NOT EXISTS (
              SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload files' AND tablename = 'objects' AND schemaname = 'storage'
          ) THEN
              CREATE POLICY "Authenticated users can upload files" 
              ON storage.objects FOR INSERT 
              TO authenticated 
              WITH CHECK (bucket_id = 'uploads');
          END IF;
          
          IF NOT EXISTS (
              SELECT 1 FROM pg_policies WHERE policyname = 'Users can read files' AND tablename = 'objects' AND schemaname = 'storage'
          ) THEN
              CREATE POLICY "Users can read files" 
              ON storage.objects FOR SELECT 
              TO authenticated 
              USING (bucket_id = 'uploads');
          END IF;
      END
      $$;
    `;
    
    await client.query(sql);
    console.log('Storage RLS policies applied successfully!');
  } catch (err) {
    console.error('Error applying policies:', err);
  } finally {
    await client.end();
  }
}

run();
