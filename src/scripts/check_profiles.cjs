const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    await client.connect();
    const { rows } = await client.query('SELECT id, email, name, role FROM public.profiles');
    console.log('PROFILES:', rows);
    
    const { rows: users } = await client.query('SELECT id, email, raw_user_meta_data FROM auth.users');
    console.log('USERS:', users.map(u => ({ id: u.id, email: u.email, meta: u.raw_user_meta_data })));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

check();
