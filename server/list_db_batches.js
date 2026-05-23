require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
global.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  try {
    const { data: batches, error } = await supabase
      .from('batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
      
    if (error) throw error;
    console.log("Recent batches in DB:", JSON.stringify(batches, null, 2));
    
    for (const batch of batches) {
      const { data: results, error: resError } = await supabase
        .from('vouching_results')
        .select('*')
        .eq('batch_id', batch.id)
        .limit(5);
      if (resError) throw resError;
      console.log(`\nBatch ID: ${batch.id} | Filename: ${batch.filename} | Status: ${batch.status}`);
      console.log("Sample results (first 5):", JSON.stringify(results, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
