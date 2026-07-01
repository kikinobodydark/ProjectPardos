import { supabase } from '../src/utils/supabaseClient.js';

const run = async () => {
  const { data, error } = await supabase
    .from('detalle_validacion')
    .select('id, estado_validacion, errores_json')
    .neq('estado_validacion', 'OK')
    .limit(5);

  if (error) {
    console.error('Error fetching data:', error);
  } else {
    console.log('Fetched data:', JSON.stringify(data, null, 2));
  }
};

run();
