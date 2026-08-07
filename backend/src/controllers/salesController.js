const supabase = require('../config/supabase');
const { success } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

async function list(req, res) {
  const { storeId, from, to } = req.query;
  let query = supabase
    .from('sales_record')
    .select('*, sourceType:sales_source_type(*)')
    .eq('store_id', storeId)
    .order('sales_date', { ascending: true });
  if (from) query = query.gte('sales_date', from);
  if (to) query = query.lte('sales_date', to);
  const { data: sales, error } = await query;
  if (error) throw error;
  return success(res, sales);
}

async function create(req, res) {
  const { storeId, date, amount, sourceTypeName } = req.body;

  const { data: sourceType, error: sourceTypeError } = await supabase
    .from('sales_source_type')
    .upsert({ name: sourceTypeName || 'MANUAL_ENTRY' }, { onConflict: 'name' })
    .select()
    .single();
  if (sourceTypeError) throw sourceTypeError;

  const { data: record, error } = await supabase
    .from('sales_record')
    .insert({
      store_id: storeId,
      sales_date: date,
      amount: Number(amount),
      source_type_id: sourceType.id,
      entered_by: req.user.id,
    })
    .select()
    .single();
  if (error) throw error;

  await logActivity({ userId: req.user.id, action: 'CREATE_SALES_RECORD', storeId, details: { date, amount } });

  return success(res, record, 'Sales record created', 201);
}

module.exports = { list, create };
