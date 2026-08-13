export interface RawSalesRow {
  storeBuId: number | null;
  storeId: number | null;
  storeName: string | null;
  week: number | null;
  date: string | null;

  grossActual: number | null;
  budget: number | null;
  grossVariancePercent: number | null;

  grossActualLy: number | null;
  grossLyVariancePercent: number | null;

  grossActualMtd: number | null;
  budgetMtd: number | null;
  grossMtdVariancePercent: number | null;

  grossActualLyMtd: number | null;

  docketActual: number | null;
  docketBudget: number | null;
  docketVariancePercent: number | null;

  docketActualLy: number | null;
  docketLyVariancePercent: number | null;

  customerActual: number | null;
  customerBudget: number | null;
  customerVariancePercent: number | null;

  customerActualLy: number | null;
  customerLyVariancePercent: number | null;

  otherSales: number | null;
  serviceCharge: number | null;
}

export interface ParsedRowResult {
  data: RawSalesRow;
  errors: string[];
}

export interface StorePayload {
  storeBuId: number | null;
  storeId: number;
  storeName: string | null;
}

export interface SalesRecordPayload {
  storeId: number;
  storeBuId: number | null;
  storeName: string | null;
  week: number | null;
  date: string;

  gross: {
    actual: number | null;
    budget: number | null;
    variancePercent: number | null;
    actualLastYear: number | null;
    lastYearVariancePercent: number | null;
    mtdActual: number | null;
    mtdBudget: number | null;
    mtdVariancePercent: number | null;
    mtdActualLastYear: number | null;
  };

  docket: {
    actual: number | null;
    budget: number | null;
    variancePercent: number | null;
    actualLastYear: number | null;
    lastYearVariancePercent: number | null;
  };

  customer: {
    actual: number | null;
    budget: number | null;
    variancePercent: number | null;
    actualLastYear: number | null;
    lastYearVariancePercent: number | null;
  };

  otherSales: number | null;
  serviceCharge: number | null;
}

export type RowStatus = 'valid' | 'invalid' | 'skipped';

export interface PreviewRow {
  rowNumber: number;
  status: RowStatus;
  data: RawSalesRow | null;
  errors: string[];
}

export interface FailedRow {
  rowNumber: number;
  errors: string[];
}

export interface ImportSummary {
  total: number;
  imported: number;
  failed: number;
  skipped: number;
}
