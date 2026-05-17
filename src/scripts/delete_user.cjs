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
    await client.query("DELETE FROM auth.users WHERE email = 'aru45584@gmail.com'");
    console.log('User deleted successfully!');
  } finally {
    await client.end();
  }
}

run();
