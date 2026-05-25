const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query(`SELECT batch_id, count(*) as row_count, min(status) as st FROM vouching_results GROUP BY batch_id ORDER BY batch_id;`);
  console.log(res.rows);
  await client.end();
}
run();
