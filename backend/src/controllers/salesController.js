const supabase = require('../config/supabase');
const { success } = require('../utils/apiResponse');

/**
 * Reported daily sales for a store.
 *
 * Reads `sales_report` — the table the Sales Report Excel import fills and the table the daily
 * forecast is built from (forecastRepository.findDailySalesHistory). It used to read
 * `sales_record`, a parallel table that no import writes to and that has been empty chain-wide
 * (0 rows against sales_report's 118,052), so this endpoint always returned [] and the Sales
 * screen showed nothing while the data it wanted sat in the other table the whole time.
 *
 * `report_date`/`gross_actual` are aliased to the `sales_date`/`amount` names the screen already
 * consumes, so the response contract is unchanged.
 *
 * Rows whose gross_actual is still null are excluded: sales_report also holds future/budget rows
 * that have no actual yet (store 1001 has 31 such rows for July 2026), and returning those as
 * zero-baht days would drag the screen's "average per day" down with days nobody has reported.
 */
async function list(req, res) {
  const { storeId, from, to } = req.query;
  let query = supabase
    .from('sales_report')
    .select('id, store_id, sales_date:report_date, amount:gross_actual, docket_actual, customer_actual')
    .eq('store_id', storeId)
    .not('gross_actual', 'is', null)
    .order('report_date', { ascending: true });
  if (from) query = query.gte('report_date', from);
  if (to) query = query.lte('report_date', to);
  const { data: sales, error } = await query;
  if (error) throw error;
  return success(res, sales);
}

module.exports = { list };
