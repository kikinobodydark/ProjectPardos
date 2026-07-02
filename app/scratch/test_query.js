import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://hlzdziwwdhsazazqdbrm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsemR6aXd3ZGhzYXphenFkYnJtIiwicm9sZSI6ImhsemR6aXd3ZGhzYXphenFkYnJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1OTE4OTUsImV4cCI6MjA5ODE2Nzg5NX0.vCF1i0tvImwJPTTB3x-jPT43ojEOwatTY2V9NygctZE';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  // Fetch active period
  console.log('Fetching periods...');
  const { data: periods, error: pErr } = await supabase
    .from('periodos_carga')
    .select('*')
    .limit(1);
  if (pErr) {
    console.error('Error fetching periods:', pErr);
    return;
  }
  if (!periods || periods.length === 0) {
    console.log('No periods found');
    return;
  }

  const periodId = periods[0].id;
  console.log(`Using Period ID: ${periodId} (${periods[0].periodo})`);

  console.log('Fetching first page...');
  const { data: page0, count, error: err0 } = await supabase
    .from('detalle_ventas')
    .select('*', { count: 'exact' })
    .eq('periodo_id', periodId)
    .order('fecha_emision', { ascending: true })
    .order('serie', { ascending: true })
    .order('correlativo', { ascending: true })
    .range(0, 999);
  
  if (err0) {
    console.error('Error fetching page 0:', err0);
    return;
  }
  
  console.log(`Page 0 length: ${page0.length}, Total count: ${count}`);

  console.log('Fetching second page...');
  const { data: page1, error: err1 } = await supabase
    .from('detalle_ventas')
    .select('*')
    .eq('periodo_id', periodId)
    .order('fecha_emision', { ascending: true })
    .order('serie', { ascending: true })
    .order('correlativo', { ascending: true })
    .range(1000, 1999);
  
  if (err1) {
    console.error('Error fetching page 1:', err1);
    return;
  }

  console.log(`Page 1 length: ${page1.length}`);
  if (page1.length > 0) {
    console.log('First item on page 1:', page1[0].serie, page1[0].correlativo);
  }
}

test();
