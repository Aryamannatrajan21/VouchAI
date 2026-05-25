const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query(`SELECT id, email FROM auth.users;`);
  console.log(res.rows);
  const res2 = await client.query(`SELECT id, user_id FROM batches;`);
  console.log(res2.rows);
  await client.end();
}
run();
