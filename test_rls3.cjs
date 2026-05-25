const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query(`SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'profiles';`);
  console.log(res.rows);
  await client.end();
}
run();
