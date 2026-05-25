const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  try {
    const sql = `
      -- Allow users to delete their own batches
      DROP POLICY IF EXISTS "Users can delete their own batches" ON batches;
      CREATE POLICY "Users can delete their own batches"
      ON batches FOR DELETE
      USING (auth.uid() = user_id);
      
      -- Also allow admins to delete any batch
      DROP POLICY IF EXISTS "Admins can delete all batches" ON batches;
      CREATE POLICY "Admins can delete all batches"
      ON batches FOR DELETE
      USING (get_user_role() = 'admin');
    `;
    await client.query(sql);
    console.log('Successfully added delete policies for batches!');
  } catch (err) {
    console.error('Error adding delete policies:', err);
  } finally {
    await client.end();
  }
}

run();
