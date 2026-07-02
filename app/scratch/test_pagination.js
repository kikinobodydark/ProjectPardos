import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const urlMatch = env.match(/VITE_SUPABASE_URL=(.*)/);
const keyMatch = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/);

const url = urlMatch[1].trim();
const key = keyMatch[1].trim();

const supabase = createClient(url, key);

async function test() {
  const periodId = '198a5e4a-3b8d-4a80-833b-032fe3f6285e';
  let allRows = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    console.log(`Fetching page ${page} (range: ${page * pageSize} to ${(page + 1) * pageSize - 1})...`);
    const { data, error } = await supabase
      .from('detalle_ventas')
      .select('*')
      .eq('periodo_id', periodId)
      .order('fecha_emision', { ascending: true })
      .order('serie', { ascending: true })
      .order('correlativo', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('Error fetching:', error);
      break;
    }

    console.log(`Fetched ${data.length} records`);
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allRows = allRows.concat(data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }

  console.log(`Finished. Total downloaded records: ${allRows.length}`);
}

test();
