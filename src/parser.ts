import { ParsedRowResult, RawSalesRow } from './types';
import { excelDateToISO, toNumberOrNull, toPercentDecimal, trimOrNull } from './utils';

// Column positions match the fixed report layout (A-Z), not header text.
const COL = {
  storeBuId: 0, // A
  storeId: 1, // B
  storeName: 2, // C
  week: 3, // D
  date: 4, // E

  grossActual: 5, // F
  budget: 6, // G
  grossVariancePercent: 7, // H

  grossActualLy: 8, // I
  grossLyVariancePercent: 9, // J

  grossActualMtd: 10, // K
  budgetMtd: 11, // L
  grossMtdVariancePercent: 12, // M

  grossActualLyMtd: 13, // N

  docketActual: 14, // O
  docketBudget: 15, // P
  docketVariancePercent: 16, // Q

  docketActualLy: 17, // R
  docketLyVariancePercent: 18, // S

  customerActual: 19, // T
  customerBudget: 20, // U
  customerVariancePercent: 21, // V

  customerActualLy: 22, // W
  customerLyVariancePercent: 23, // X

  otherSales: 24, // Y
  serviceCharge: 25, // Z
} as const;

const REQUIRED_FIELDS: Array<{ key: keyof RawSalesRow; label: string }> = [
  { key: 'storeId', label: 'Store ID (column B)' },
  { key: 'date', label: 'Date (column E)' },
];

export function parseRow(row: unknown[]): ParsedRowResult {
  const data: RawSalesRow = {
    storeBuId: toNumberOrNull(row[COL.storeBuId]),
    storeId: toNumberOrNull(row[COL.storeId]),
    storeName: trimOrNull(row[COL.storeName]),
    week: toNumberOrNull(row[COL.week]),
    date: excelDateToISO(row[COL.date]),

    grossActual: toNumberOrNull(row[COL.grossActual]),
    budget: toNumberOrNull(row[COL.budget]),
    grossVariancePercent: toPercentDecimal(row[COL.grossVariancePercent]),

    grossActualLy: toNumberOrNull(row[COL.grossActualLy]),
    grossLyVariancePercent: toPercentDecimal(row[COL.grossLyVariancePercent]),

    grossActualMtd: toNumberOrNull(row[COL.grossActualMtd]),
    budgetMtd: toNumberOrNull(row[COL.budgetMtd]),
    grossMtdVariancePercent: toPercentDecimal(row[COL.grossMtdVariancePercent]),

    grossActualLyMtd: toNumberOrNull(row[COL.grossActualLyMtd]),

    docketActual: toNumberOrNull(row[COL.docketActual]),
    docketBudget: toNumberOrNull(row[COL.docketBudget]),
    docketVariancePercent: toPercentDecimal(row[COL.docketVariancePercent]),

    docketActualLy: toNumberOrNull(row[COL.docketActualLy]),
    docketLyVariancePercent: toPercentDecimal(row[COL.docketLyVariancePercent]),

    customerActual: toNumberOrNull(row[COL.customerActual]),
    customerBudget: toNumberOrNull(row[COL.customerBudget]),
    customerVariancePercent: toPercentDecimal(row[COL.customerVariancePercent]),

    customerActualLy: toNumberOrNull(row[COL.customerActualLy]),
    customerLyVariancePercent: toPercentDecimal(row[COL.customerLyVariancePercent]),

    otherSales: toNumberOrNull(row[COL.otherSales]),
    serviceCharge: toNumberOrNull(row[COL.serviceCharge]),
  };

  const errors: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (data[field.key] === null) errors.push(`Missing required field: ${field.label}`);
  }

  return { data, errors };
}
