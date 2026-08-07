import { RawSalesRow, SalesRecordPayload, StorePayload } from './types';

// Required fields are already validated by parser.ts before this runs, so the
// non-null assertions on storeId/date are safe here.

export function mapToStorePayload(row: RawSalesRow): StorePayload {
  return {
    storeBuId: row.storeBuId,
    storeId: row.storeId as string,
    storeName: row.storeName,
  };
}

export function mapToSalesRecordPayload(row: RawSalesRow): SalesRecordPayload {
  return {
    storeId: row.storeId as string,
    storeBuId: row.storeBuId,
    storeName: row.storeName,
    week: row.week,
    date: row.date as string,

    gross: {
      actual: row.grossActual,
      budget: row.budget,
      variancePercent: row.grossVariancePercent,
      actualLastYear: row.grossActualLy,
      lastYearVariancePercent: row.grossLyVariancePercent,
      mtdActual: row.grossActualMtd,
      mtdBudget: row.budgetMtd,
      mtdVariancePercent: row.grossMtdVariancePercent,
      mtdActualLastYear: row.grossActualLyMtd,
    },

    docket: {
      actual: row.docketActual,
      budget: row.docketBudget,
      variancePercent: row.docketVariancePercent,
      actualLastYear: row.docketActualLy,
      lastYearVariancePercent: row.docketLyVariancePercent,
    },

    customer: {
      actual: row.customerActual,
      budget: row.customerBudget,
      variancePercent: row.customerVariancePercent,
      actualLastYear: row.customerActualLy,
      lastYearVariancePercent: row.customerLyVariancePercent,
    },

    otherSales: row.otherSales,
    serviceCharge: row.serviceCharge,
  };
}
