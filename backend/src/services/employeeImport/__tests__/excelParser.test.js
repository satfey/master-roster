const ExcelJS = require('exceljs');
const { parseEmployeeMasterWorkbook } = require('../excelParser');

const ALL_HEADERS_IN_ORDER = [
  'Employee ID', 'Legal Name - Title', 'Legal Name - First Name', 'Legal Name - Last Name',
  'First Name - Local', 'Last Name - Local', 'Email - Primary Home', 'Position Title',
  'Position Time Type', 'Location', 'Default Weekly Hours', 'Pay Rate Type',
  'SL Comp Plan', 'SL Comp Amount', 'SL Comp Currency', 'SL Comp Frequency',
  'HR Comp Plan', 'HR Comp Amount', 'HR Comp Currency', 'HR Comp Frequency',
];

async function buildWorkbook(headers, rows, preambleRowCount = 0) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (let i = 0; i < preambleRowCount; i++) ws.addRow(i === 0 ? ['Employee Master Report'] : []);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

describe('employeeImport excelParser', () => {
  test('detects the header row dynamically regardless of preamble length', async () => {
    const buffer = await buildWorkbook(ALL_HEADERS_IN_ORDER, [['000123', ...Array(19).fill(null)]], 5);
    const { headerRowNumber, rows } = await parseEmployeeMasterWorkbook(buffer);
    expect(headerRowNumber).toBe(6);
    expect(rows).toHaveLength(1);
  });

  test('10. tolerates hundreds of extra unrelated columns — only the 20 known ones are read', async () => {
    const extraHeaders = Array.from({ length: 50 }, (_, i) => `Unrelated Column ${i}`);
    const headers = [...ALL_HEADERS_IN_ORDER.slice(0, 3), ...extraHeaders, ...ALL_HEADERS_IN_ORDER.slice(3)];
    const row = ['000123', 'Mr.', 'Somchai', ...Array(50).fill('ignore me'), 'Jaidee', ...Array(16).fill(null)];
    const buffer = await buildWorkbook(headers, [row]);

    const { rows } = await parseEmployeeMasterWorkbook(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0].employeeId).toBe('000123');
    expect(rows[0].firstName).toBe('Somchai');
    expect(rows[0].lastName).toBe('Jaidee');
    // None of the 50 unrelated columns leak into the parsed row under any field name.
    expect(Object.keys(rows[0])).toEqual(
      expect.arrayContaining(['rowNumber', 'employeeId', 'title', 'firstName', 'lastName', 'firstNameLocal', 'lastNameLocal'])
    );
    expect(Object.values(rows[0])).not.toContain('ignore me');
  });

  test('11. tolerates the 20 columns being in a completely different order', async () => {
    const shuffled = [...ALL_HEADERS_IN_ORDER].reverse(); // Employee ID now last
    const rowInShuffledOrder = [
      'Hourly', 'THB', 700, 'Bonus',           // HR freq/currency/amount/plan (reversed order)
      'Monthly', 'THB', 500, 'Base',           // SL freq/currency/amount/plan
      'Hourly', 40, 'DQ1005-CENTER ONE',       // pay rate type, hours, location
      'Full time', 'Cashier',                  // position time type, position title
      'somchai.j@example.com',                 // email
      'Jaidee', 'สมชาย',                        // last name local, first name local (reversed)
      'Jaidee', 'Somchai', 'Mr.',               // legal last, first, title (reversed)
      '000123',                                 // employee id (now last)
    ];
    const buffer = await buildWorkbook(shuffled, [rowInShuffledOrder]);

    const { rows } = await parseEmployeeMasterWorkbook(buffer);

    expect(rows[0].employeeId).toBe('000123');
    expect(rows[0].firstName).toBe('Somchai');
    expect(rows[0].storeName).toBe('DQ1005-CENTER ONE');
    expect(rows[0].hrCompAmount).toBe(700);
  });

  test('14. only the 20 requested fields ever appear on a parsed row — nothing else', async () => {
    const buffer = await buildWorkbook(ALL_HEADERS_IN_ORDER, [['000123', ...Array(19).fill(null)]]);
    const { rows } = await parseEmployeeMasterWorkbook(buffer);

    const expectedFields = [
      'rowNumber', 'employeeId', 'title', 'firstName', 'lastName', 'firstNameLocal', 'lastNameLocal',
      'email', 'position', 'positionTimeType', 'storeName', 'defaultWeeklyHours', 'payRateType',
      'slCompPlan', 'slCompAmount', 'slCompCurrency', 'slCompFrequency',
      'hrCompPlan', 'hrCompAmount', 'hrCompCurrency', 'hrCompFrequency',
    ];
    expect(Object.keys(rows[0]).sort()).toEqual(expectedFields.sort());
  });

  test('blank rows are ignored completely', async () => {
    const buffer = await buildWorkbook(ALL_HEADERS_IN_ORDER, [
      ['000123', ...Array(19).fill(null)],
      [],
      ['000456', ...Array(19).fill(null)],
    ]);
    const { rows } = await parseEmployeeMasterWorkbook(buffer);
    expect(rows).toHaveLength(2);
  });

  test('throws a clear error if no header row can be found', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['nothing', 'matches', 'the', 'expected', 'labels']);
    const buffer = await wb.xlsx.writeBuffer();
    await expect(parseEmployeeMasterWorkbook(buffer)).rejects.toThrow(/Could not find the Employee Master header row/);
  });
});
