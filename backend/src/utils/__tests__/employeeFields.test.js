const fs = require('fs');
const path = require('path');
const { EMPLOYEE_PUBLIC_COLUMNS, EMPLOYEE_PUBLIC_EMBED } = require('../employeeFields');

/** Every pay-carrying column on the `employee` table. */
const COMPENSATION_COLUMNS = [
  'pay_rate_type',
  'sl_comp_plan',
  'sl_comp_amount',
  'sl_comp_currency',
  'sl_comp_frequency',
  'hr_comp_plan',
  'hr_comp_amount',
  'hr_comp_currency',
  'hr_comp_frequency',
];

const columns = EMPLOYEE_PUBLIC_COLUMNS.split(',').map((c) => c.trim());

describe('EMPLOYEE_PUBLIC_COLUMNS — what may leave the API', () => {
  test.each(COMPENSATION_COLUMNS)('%s is never exposed', (column) => {
    expect(columns).not.toContain(column);
  });

  test('no column matching a pay pattern slips in as the schema grows', () => {
    expect(columns.filter((c) => /comp_|pay_rate|salary|wage|rate_amount/.test(c))).toEqual([]);
  });

  test('the fields the roster and staff screens actually render are all present', () => {
    // Sourced from the frontend: rosterAdapter's staffNameOf/employmentTypeOf and StaffManagementPage.
    for (const needed of [
      'id',
      'store_id',
      'first_name',
      'last_name',
      'first_name_local',
      'last_name_local',
      'position',
      'position_time_type',
      'default_weekly_hours',
      'is_active',
    ]) {
      expect(columns).toContain(needed);
    }
  });

  test('it is a plain column list — a wildcard would drag pay straight back in', () => {
    expect(EMPLOYEE_PUBLIC_COLUMNS).not.toContain('*');
  });

  test('the embedded form wraps the same list, for `shift(*, employee(...))` selects', () => {
    expect(EMPLOYEE_PUBLIC_EMBED).toBe(`employee(${EMPLOYEE_PUBLIC_COLUMNS})`);
    expect(EMPLOYEE_PUBLIC_EMBED).not.toContain('employee(*)');
  });
});

/**
 * A guard rather than a unit test: `employee(*)` is easy to reintroduce by habit, and every place
 * it appears in a client-facing read puts salaries back on the wire.
 */
describe('no client-facing select may embed employee(*)', () => {
  const SRC = path.join(__dirname, '..', '..');

  /**
   * The deliberate exception: rosterValidationService.computeShiftCost needs the wage figures to
   * total up labour cost, and publishes only the aggregate — never a per-person amount.
   */
  const INTERNAL_ONLY = ['repositories/rosterRepository.js'];

  function jsFilesUnder(dir) {
    const found = [];
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        if (entry !== '__tests__') found.push(...jsFilesUnder(full));
      } else if (entry.endsWith('.js')) {
        found.push(full);
      }
    }
    return found;
  }

  /** Comments discuss `employee(*)` by name; only actual code counts as an offence. */
  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  test('controllers, services and repositories select explicit employee columns', () => {
    const offenders = ['controllers', 'services', 'repositories']
      .flatMap((dir) => jsFilesUnder(path.join(SRC, dir)))
      .map((full) => path.relative(SRC, full).split(path.sep).join('/'))
      .filter((rel) => !INTERNAL_ONLY.includes(rel))
      .filter((rel) => stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8')).includes('employee(*)'));

    expect(offenders).toEqual([]);
  });
});
