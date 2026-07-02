import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const urlMatch = env.match(/VITE_SUPABASE_URL=(.*)/);
const keyMatch = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/);

const url = urlMatch[1].trim();
const key = keyMatch[1].trim();

console.log('URL:', url);
console.log('Key length:', key.length);

const supabase = createClient(url, key);

async function test() {
  const { data, error } = await supabase.from('periodos_carga').select('*').limit(1);
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Success! Period:', data);
  }
}
test();
