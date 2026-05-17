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
  const res = await client.query(`SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'vouching_results';`);
  console.log(res.rows);
  await client.end();
}
run();
