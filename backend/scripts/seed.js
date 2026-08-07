require('dotenv').config();
const supabase = require('../src/config/supabase');

// Fixed, predictable UUIDs so this script is idempotent (safe to re-run —
// every insert is an upsert keyed on id). These match the ids already used
// throughout the Swagger examples (see src/routes/*.js).

const ROLE_ADMIN = '11111111-1111-1111-1111-111111111111';
const ROLE_AREA_COACH = '22222222-2222-2222-2222-222222222222';
const ROLE_STORE_MANAGER = '33333333-3333-3333-3333-333333333333';

const STORE_BANGNA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const STORE_LADPRAO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';

const USER_ADMIN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001';
const USER_AREA_COACH = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002';
const USER_MANAGER_BANGNA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb003';
const USER_MANAGER_LADPRAO = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb004';

const EMPLOYEE_CASHIER = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
const EMPLOYEE_BARISTA = 'cccccccc-cccc-cccc-cccc-cccccccc0002';

const SOURCE_TYPE_POS = 'dddddddd-dddd-dddd-dddd-dddddddd0001';
const SOURCE_TYPE_GRAB = 'dddddddd-dddd-dddd-dddd-dddddddd0002';

const SALES_RECORD_1 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const SALES_RECORD_2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0002';
const SALES_RECORD_3 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0003';

const FORECAST_MODEL_RUN = '12121212-1212-1212-1212-121212121212';
const FORECAST_BANGNA = '13131313-1313-1313-1313-131313131301';
const FORECAST_LADPRAO = '13131313-1313-1313-1313-131313131302';

const GUIDELINE_BANGNA = '14141414-1414-1414-1414-141414141401';

const ROSTER_BANGNA_WEEK = '16161616-1616-1616-1616-161616161601';
const SHIFT_CASHIER = '17171717-1717-1717-1717-171717171701';
const SHIFT_BARISTA = '17171717-1717-1717-1717-171717171702';
const ACTUAL_HOURS_CASHIER = '18181818-1818-1818-1818-181818181801';
const ACTUAL_HOURS_BARISTA = '18181818-1818-1818-1818-181818181802';

async function upsert(table, rows, onConflict = 'id') {
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`✔ ${table}: ${rows.length} row(s)`);
}

async function seed() {
  await upsert('role', [
    { id: ROLE_ADMIN, name: 'Admin', permissions: ['ALL'] },
    { id: ROLE_AREA_COACH, name: 'Area Coach', permissions: ['VIEW_ALL', 'APPROVE_ROSTER'] },
    { id: ROLE_STORE_MANAGER, name: 'Store Manager', permissions: ['MANAGE_STORE', 'ENTER_SALES', 'MANAGE_ROSTER'] },
  ]);

  // Stores first without area_coach_id — that FK points at users, and users
  // can reference a store, so the two tables have a circular dependency.
  // We break the cycle by patching area_coach_id back in after users exist.
  await upsert('store', [
    { id: STORE_BANGNA, name: 'Bangna Store', region: 'Bangkok', area_coach_id: null },
    { id: STORE_LADPRAO, name: 'ลาดพร้าว Store', region: 'Bangkok', area_coach_id: null },
  ]);

  await upsert('users', [
    { id: USER_ADMIN, full_name: 'John Admin', email: 'admin@test.com', role_id: ROLE_ADMIN, store_id: null, is_active: true },
    { id: USER_AREA_COACH, full_name: 'Alice Area Coach', email: 'coach@test.com', role_id: ROLE_AREA_COACH, store_id: null, is_active: true },
    { id: USER_MANAGER_BANGNA, full_name: 'Bob Manager', email: 'manager1@test.com', role_id: ROLE_STORE_MANAGER, store_id: STORE_BANGNA, is_active: true },
    { id: USER_MANAGER_LADPRAO, full_name: 'Jane Manager', email: 'manager2@test.com', role_id: ROLE_STORE_MANAGER, store_id: STORE_LADPRAO, is_active: true },
  ]);

  await upsert('store', [
    { id: STORE_BANGNA, name: 'Bangna Store', region: 'Bangkok', area_coach_id: USER_AREA_COACH },
    { id: STORE_LADPRAO, name: 'ลาดพร้าว Store', region: 'Bangkok', area_coach_id: USER_AREA_COACH },
  ]);

  await upsert('employee', [
    { id: EMPLOYEE_CASHIER, store_id: STORE_BANGNA, full_name: 'สมชาย ใจดี', position: 'Cashier', hourly_rate: 120, is_active: true },
    { id: EMPLOYEE_BARISTA, store_id: STORE_BANGNA, full_name: 'สมหญิง แสนดี', position: 'Barista', hourly_rate: 130, is_active: true },
  ]);

  await upsert('sales_source_type', [
    { id: SOURCE_TYPE_POS, name: 'POS' },
    { id: SOURCE_TYPE_GRAB, name: 'Grab' },
  ]);

  await upsert('sales_record', [
    { id: SALES_RECORD_1, store_id: STORE_BANGNA, sales_date: '2026-07-25', amount: 25000, source_type_id: SOURCE_TYPE_POS, entered_by: USER_MANAGER_BANGNA },
    { id: SALES_RECORD_2, store_id: STORE_BANGNA, sales_date: '2026-07-25', amount: 5200, source_type_id: SOURCE_TYPE_GRAB, entered_by: USER_MANAGER_BANGNA },
    { id: SALES_RECORD_3, store_id: STORE_LADPRAO, sales_date: '2026-07-25', amount: 28000, source_type_id: SOURCE_TYPE_POS, entered_by: USER_MANAGER_LADPRAO },
  ]);

  await upsert('forecast_model_run', [{ id: FORECAST_MODEL_RUN, model_version: 'SMA-7', accuracy_score: null }]);

  await upsert('sales_forecast', [
    { id: FORECAST_BANGNA, store_id: STORE_BANGNA, forecast_date: '2026-08-01', daypart: 'FULL_DAY', forecasted_sales: 32000, model_run_id: FORECAST_MODEL_RUN },
    { id: FORECAST_LADPRAO, store_id: STORE_LADPRAO, forecast_date: '2026-08-01', daypart: 'FULL_DAY', forecasted_sales: 35000, model_run_id: FORECAST_MODEL_RUN },
  ]);

  await upsert('labor_guideline', [
    { id: GUIDELINE_BANGNA, store_id: STORE_BANGNA, target_productivity: 1200, target_col_percent: 22, min_staff_per_shift: 3 },
  ]);

  await upsert('roster', [
    { id: ROSTER_BANGNA_WEEK, store_id: STORE_BANGNA, week_start: '2026-08-03', status: 'APPROVED', approved_by: USER_AREA_COACH, approved_at: new Date().toISOString() },
  ]);

  await upsert('shift', [
    { id: SHIFT_CASHIER, roster_id: ROSTER_BANGNA_WEEK, employee_id: EMPLOYEE_CASHIER, shift_date: '2026-08-03', start_time: '08:00:00', end_time: '16:00:00', planned_hours: 8 },
    { id: SHIFT_BARISTA, roster_id: ROSTER_BANGNA_WEEK, employee_id: EMPLOYEE_BARISTA, shift_date: '2026-08-03', start_time: '09:00:00', end_time: '17:00:00', planned_hours: 8 },
  ]);

  await upsert('actual_hours', [
    { id: ACTUAL_HOURS_CASHIER, shift_id: SHIFT_CASHIER, actual_hours: 8, clock_in: '2026-08-03T08:01:00', clock_out: '2026-08-03T16:05:00', recorded_by: USER_MANAGER_BANGNA },
    { id: ACTUAL_HOURS_BARISTA, shift_id: SHIFT_BARISTA, actual_hours: 7.5, clock_in: '2026-08-03T09:00:00', clock_out: '2026-08-03T16:30:00', recorded_by: USER_MANAGER_BANGNA },
  ], 'shift_id');

  console.log('\nSeed complete.');
}

seed()
  .catch((err) => {
    console.error('\nSeed failed:', err.message);
    process.exitCode = 1;
  });
