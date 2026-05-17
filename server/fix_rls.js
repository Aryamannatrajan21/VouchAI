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
      -- 1. Create a security definer function to get the current user's role
      CREATE OR REPLACE FUNCTION public.get_user_role()
      RETURNS text
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS $$
        SELECT role FROM public.profiles WHERE id = auth.uid();
      $$;

      -- 2. Drop the recursive profiles policy
      DROP POLICY IF EXISTS "Admins can view all profiles." ON profiles;
      
      -- 3. Recreate the policy using the function (avoids infinite recursion)
      CREATE POLICY "Admins can view all profiles."
      ON profiles FOR SELECT
      USING ( public.get_user_role() = 'admin' );

      -- 4. Update the batches policy
      DROP POLICY IF EXISTS "Auditors and Admins can view all batches" ON batches;
      CREATE POLICY "Auditors and Admins can view all batches"
      ON batches FOR SELECT
      USING ( public.get_user_role() IN ('admin', 'auditor') );

      -- 5. Update the vouching_results policy
      DROP POLICY IF EXISTS "Auditors and Admins can view and update all results" ON vouching_results;
      CREATE POLICY "Auditors and Admins can view and update all results"
      ON vouching_results FOR ALL
      USING ( public.get_user_role() IN ('admin', 'auditor') );
    `;
    await client.query(sql);
    console.log('Fixed RLS infinite recursion successfully!');
  } catch (err) {
    console.error('Error fixing RLS:', err);
  } finally {
    await client.end();
  }
}

run();
