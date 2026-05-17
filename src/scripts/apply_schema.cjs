const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  host: 'db.ggzltbymirqpqkkollnc.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'TPwuSbskuQ6yGKeo',
  database: 'postgres',
  ssl: {
    rejectUnauthorized: false
  }
});

const sqlFile = path.join(__dirname, '../../supabase/migrations/20260516000000_initial_schema.sql');
const sql = fs.readFileSync(sqlFile, 'utf8');

async function apply() {
  try {
    await client.connect();
    console.log('Connected to Supabase DB');
    await client.query(sql);
    console.log('Schema applied successfully!');
  } catch (err) {
    console.error('Error applying schema:', err);
  } finally {
    await client.end();
  }
}

apply();
