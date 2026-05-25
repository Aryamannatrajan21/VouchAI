const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
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
