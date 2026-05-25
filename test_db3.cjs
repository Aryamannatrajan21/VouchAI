const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query(`SELECT id, user_id, status, created_at FROM batches ORDER BY created_at DESC;`);
  console.log(res.rows);
  await client.end();
}
run();
