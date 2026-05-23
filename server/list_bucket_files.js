require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
global.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  try {
    const { data: files, error } = await supabase.storage.from('uploads').list('0b125ef7-d9cc-406d-bb36-d33a1a26a3dd');
    if (error) throw error;
    console.log("Files inside folder '0b125ef7-d9cc-406d-bb36-d33a1a26a3dd':", JSON.stringify(files, null, 2));
  } catch (err) {
    console.error("Error listing storage files:", err);
  }
}

run();
