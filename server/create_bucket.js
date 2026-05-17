global.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://ggzltbymirqpqkkollnc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdnemx0YnltaXJxcHFra29sbG5jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODkxOTM2NSwiZXhwIjoyMDk0NDk1MzY1fQ.OqoVCPox_06w9xkoN7f-sWnAdwA15KyoshyA7diXV9U'
);

async function run() {
  console.log('Creating uploads bucket...');
  const { data, error } = await supabase.storage.createBucket('uploads', {
    public: true,
    allowedMimeTypes: null,
    fileSizeLimit: null
  });
  
  if (error) {
    if (error.message.includes('already exists')) {
      console.log('Bucket already exists!');
    } else {
      console.error('Error:', error);
    }
  } else {
    console.log('Bucket created successfully!', data);
  }
}

run();
