/**
 * The employee columns that may leave the API.
 *
 * The `employee` table carries each person's pay: pay_rate_type, sl_comp_* (monthly salary) and
 * hr_comp_* (hourly rate). Selecting `*` — which every employee-facing endpoint used to do, and
 * which the roster, store and labour endpoints did through an embedded `employee(*)` — put every
 * individual's salary in the response of screens that only ever needed a name and a position.
 *
 * So the list is written out, and compensation is simply absent from it.
 *
 * This does NOT change labour-cost reporting. plannedLaborCost and its hourly/monthlySalaried
 * breakdown are computed server-side in rosterValidationService.computeShiftCost() from
 * rosterRepository.findShiftsForStoreInRange(), which deliberately keeps `employee(*)` because it
 * needs the wage figures to do the arithmetic. What reaches a client from there is the aggregate,
 * never a per-person amount.
 *
 * `email` is absent too. It is personal contact data, no screen in this app renders it (checked
 * across frontend/src — Staff Management shows name, position and employment type only), and an
 * unused PII field in every roster response is a leak waiting to happen. The import path still
 * WRITES it, so nothing is lost from the record; it simply is not handed out again.
 */
const EMPLOYEE_PUBLIC_COLUMNS = [
  'id',
  'store_id',
  'store_name',
  'title',
  'first_name',
  'last_name',
  'first_name_local',
  'last_name_local',
  'position',
  'position_time_type',
  'default_weekly_hours',
  'is_active',
  'created_at',
  'updated_at',
].join(', ');

/** The same list shaped for a PostgREST embedded select, e.g. `shift(*, employee(...))`. */
const EMPLOYEE_PUBLIC_EMBED = `employee(${EMPLOYEE_PUBLIC_COLUMNS})`;

module.exports = { EMPLOYEE_PUBLIC_COLUMNS, EMPLOYEE_PUBLIC_EMBED };
