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
  const res = await client.query(`SELECT id, email FROM auth.users;`);
  console.log(res.rows);
  const res2 = await client.query(`SELECT id, user_id FROM batches;`);
  console.log(res2.rows);
  await client.end();
}
run();
