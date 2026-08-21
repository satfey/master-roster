const ExcelJS = require('exceljs');

// Explicit factory (not automock) so the real module — which creates a
// Supabase client at require-time — is never loaded during tests.
jest.mock('../../../repositories/employeeImportRepository', () => ({
  findAllStores: jest.fn(),
  findEmployeesByIds: jest.fn(),
  createEmployees: jest.fn(),
  updateEmployees: jest.fn(),
}));
const repo = require('../../../repositories/employeeImportRepository');

const { previewEmployeeImport, commitEmployeeImport } = require('../employeeImportService');

const HEADERS = [
  'Employee ID', 'Legal Name - Title', 'Legal Name - First Name', 'Legal Name - Last Name',
  'First Name - Local', 'Last Name - Local', 'Email - Primary Home', 'Position Title',
  'Position Time Type', 'Location', 'Default Weekly Hours', 'Pay Rate Type',
  'SL Comp Plan', 'SL Comp Amount', 'SL Comp Currency', 'SL Comp Frequency',
  'HR Comp Plan', 'HR Comp Amount', 'HR Comp Currency', 'HR Comp Frequency',
];

/** Builds one full 20-column row from a partial object, in header order, defaulting everything else to null. */
function row({
  employeeId = null, title = null, firstName = null, lastName = null, firstNameLocal = null, lastNameLocal = null,
  email = null, position = null, positionTimeType = null, location = null, defaultWeeklyHours = null, payRateType = null,
  slCompPlan = null, slCompAmount = null, slCompCurrency = null, slCompFrequency = null,
  hrCompPlan = null, hrCompAmount = null, hrCompCurrency = null, hrCompFrequency = null,
} = {}) {
  return [
    employeeId, title, firstName, lastName, firstNameLocal, lastNameLocal, email, position, positionTimeType, location,
    defaultWeeklyHours, payRateType, slCompPlan, slCompAmount, slCompCurrency, slCompFrequency,
    hrCompPlan, hrCompAmount, hrCompCurrency, hrCompFrequency,
  ];
}

async function buildWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

/** In-memory fake `store` table, keyed by id (post store.id-migration, id IS the Store ID). */
function fakeStores(stores) {
  repo.findAllStores.mockResolvedValue(stores);
}

/** In-memory fake `employee` table keyed by id — employee.id IS the Excel Employee ID directly, so this also proves upsert reuses the same row across commits. */
function createFakeEmployeeTable(initial = []) {
  const byId = new Map(initial.map((e) => [e.id, e]));

  repo.findEmployeesByIds.mockImplementation(async (ids) => {
    const map = new Map();
    for (const id of ids) if (byId.has(id)) map.set(id, byId.get(id));
    return map;
  });

  repo.createEmployees.mockImplementation(async (records) => {
    for (const r of records) byId.set(r.id, { ...r });
    return records;
  });

  repo.updateEmployees.mockImplementation(async (updates) => {
    const updated = [];
    for (const u of updates) {
      const existing = byId.get(u.id);
      if (!existing) continue;
      Object.assign(existing, u);
      updated.push({ ...existing });
    }
    return updated;
  });

  return byId;
}

beforeEach(() => {
  jest.clearAllMocks();
  fakeStores([]);
  createFakeEmployeeTable([]);
});

describe('employeeImportService — create vs update (upsert by employee.id)', () => {
  test('1. a new Employee ID creates a new employee', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', firstName: 'Somchai', lastName: 'Jaidee', location: '1005' })]);

    const preview = await previewEmployeeImport(buffer);
    expect(preview.rows[0].status).toBe('valid');
    expect(preview.rows[0].action).toBe('CREATE');

    const result = await commitEmployeeImport(buffer);
    expect(result.created).toBe(1);
    expect(result.employeesCreated[0]).toMatchObject({ employeeId: '000123', name: 'Somchai Jaidee' });
    expect(repo.createEmployees.mock.calls[0][0][0]).toMatchObject({ id: '000123', store_id: '1005', first_name: 'Somchai', last_name: 'Jaidee' });
  });

  test('2. an existing Employee ID updates that employee instead of creating a duplicate', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    createFakeEmployeeTable([{ id: '000123', store_id: '1005', first_name: 'Old', last_name: 'Name', title: null, first_name_local: null, last_name_local: null, email: null, position: null, position_time_type: null, store_name: null, default_weekly_hours: null, pay_rate_type: null, sl_comp_plan: null, sl_comp_amount: null, sl_comp_currency: null, sl_comp_frequency: null, hr_comp_plan: null, hr_comp_amount: null, hr_comp_currency: null, hr_comp_frequency: null }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', firstName: 'New', lastName: 'Name', location: '1005' })]);

    const result = await commitEmployeeImport(buffer);

    expect(repo.createEmployees).toHaveBeenCalledWith([]);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.employeesUpdated[0].employeeId).toBe('000123');
  });

  test('12. re-importing the same file does not create a duplicate employee', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', firstName: 'Somchai', lastName: 'Jaidee', location: '1005' })]);

    const first = await commitEmployeeImport(buffer);
    expect(first.created).toBe(1);

    const second = await commitEmployeeImport(buffer);
    expect(second.created).toBe(0);
    expect(second.unchanged).toBe(1); // identical data — nothing to write
    expect(repo.createEmployees).toHaveBeenLastCalledWith([]); // called again, but with nothing to create
  });

  test('a row that already matches the DB exactly is reported unchanged and writes nothing', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    createFakeEmployeeTable([{
      id: '000123', store_id: '1005', first_name: 'Somchai', last_name: 'Jaidee',
      title: null, first_name_local: null, last_name_local: null, email: null, position: null, position_time_type: null,
      store_name: '1005', default_weekly_hours: null, pay_rate_type: null, sl_comp_plan: null, sl_comp_amount: null,
      sl_comp_currency: null, sl_comp_frequency: null, hr_comp_plan: null, hr_comp_amount: null, hr_comp_currency: null, hr_comp_frequency: null,
    }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', firstName: 'Somchai', lastName: 'Jaidee', location: '1005' })]);

    const result = await commitEmployeeImport(buffer);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(repo.updateEmployees).toHaveBeenCalledWith([]);
  });
});

describe('employeeImportService — Employee ID validation', () => {
  test('4. leading-zero Employee IDs are preserved exactly (never round-tripped through Number())', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', location: '1005' })]);

    const preview = await previewEmployeeImport(buffer);
    expect(preview.rows[0].employeeId).toBe('000123');

    const result = await commitEmployeeImport(buffer);
    expect(result.employeesCreated[0].employeeId).toBe('000123');
  });

  test('5. a missing Employee ID is invalid and is not inserted', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({ employeeId: null, firstName: 'Somchai', location: '1005' })]);

    const preview = await previewEmployeeImport(buffer);
    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.rows[0].errors).toContain('Missing Employee ID');

    const result = await commitEmployeeImport(buffer);
    expect(result.created).toBe(0);
    expect(result.failed).toHaveLength(1);
  });

  test('3. duplicate Employee ID within the same file invalidates every row that shares it', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([
      row({ employeeId: '000123', firstName: 'A', location: '1005' }),
      row({ employeeId: '000123', firstName: 'B', location: '1005' }),
    ]);

    const preview = await previewEmployeeImport(buffer);
    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.rows[1].status).toBe('invalid');
    expect(preview.rows[0].errors.some((e) => e.includes('Duplicate Employee ID'))).toBe(true);

    const result = await commitEmployeeImport(buffer);
    expect(result.created).toBe(0);
    expect(result.failed).toHaveLength(2);
  });
});

describe('employeeImportService — Location resolution (store_name / store_id)', () => {
  test('6. Location resolves to store_id and is also stored verbatim as store_name', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', location: 'DQ1005-CENTER ONE' })]);

    const preview = await previewEmployeeImport(buffer);
    expect(preview.rows[0].status).toBe('valid');
    expect(preview.rows[0].resolvedStoreId).toBe('1005');
    expect(preview.rows[0].storeName).toBe('DQ1005-CENTER ONE');

    await commitEmployeeImport(buffer);
    const [records] = repo.createEmployees.mock.calls[0];
    expect(records[0].store_id).toBe('1005');
    expect(records[0].store_name).toBe('DQ1005-CENTER ONE');
  });

  test('Location matching also works when it directly holds the canonical Store ID', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', location: '1005' })]);

    const preview = await previewEmployeeImport(buffer);
    expect(preview.rows[0].resolvedStoreId).toBe('1005');
  });

  test('7. an unresolvable Location marks the row invalid — no UUID or random store is invented', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', location: 'Nonexistent Branch' })]);

    const preview = await previewEmployeeImport(buffer);
    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.rows[0].errors.some((e) => e.includes('Unknown Location'))).toBe(true);
    expect(preview.rows[0].resolvedStoreId).toBeNull();

    const result = await commitEmployeeImport(buffer);
    expect(result.created).toBe(0);
    expect(repo.createEmployees).toHaveBeenCalledWith([]);
  });

  test('a blank Location is invalid (store_id is required) rather than left null', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', location: null })]);

    const preview = await previewEmployeeImport(buffer);
    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.rows[0].errors).toContain('Missing Location');
  });
});

describe('employeeImportService — optional fields and numeric parsing', () => {
  test('8. blank optional fields become NULL, never the strings "null"/"undefined"/"NaN"', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', location: '1005' })]); // everything else blank

    await commitEmployeeImport(buffer);
    const [records] = repo.createEmployees.mock.calls[0];
    const record = records[0];

    for (const field of ['title', 'first_name', 'email', 'position', 'sl_comp_plan', 'hr_comp_currency']) {
      expect(record[field]).toBeNull();
      expect(record[field]).not.toBe('null');
      expect(record[field]).not.toBe('undefined');
    }
  });

  test('9. numeric compensation fields are parsed as numbers, not strings', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({
      employeeId: '000123', location: '1005',
      defaultWeeklyHours: 40, slCompAmount: 15000, hrCompAmount: '250.50',
    })]);

    await commitEmployeeImport(buffer);
    const [records] = repo.createEmployees.mock.calls[0];

    expect(records[0].default_weekly_hours).toBe(40);
    expect(records[0].sl_comp_amount).toBe(15000);
    expect(records[0].hr_comp_amount).toBeCloseTo(250.5);
    expect(records[0].hr_comp_amount).not.toBe('250.50');
    expect(Number.isNaN(records[0].hr_comp_amount)).toBe(false);
  });
});

describe('employeeImportService — preview never writes to the DB', () => {
  test('13. preview never calls createEmployees or updateEmployees', async () => {
    fakeStores([{ id: '1005', name: 'DQ1005-CENTER ONE' }]);
    const buffer = await buildWorkbook([row({ employeeId: '000123', location: '1005' })]);

    await previewEmployeeImport(buffer);

    expect(repo.createEmployees).not.toHaveBeenCalled();
    expect(repo.updateEmployees).not.toHaveBeenCalled();
  });
});
