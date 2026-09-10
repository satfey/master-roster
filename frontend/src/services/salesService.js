// Sales figures for the Sales screen, from the real backend.
//
// Two different things are shown here and they must not be confused:
//   - ACTUAL sales come from sales_report, via GET /sales.
//   - FORECAST sales come from the production forecast, via GET /forecast/preview
//     and /forecast/hourly/preview.
// Nothing here invents a figure; a store with no reported sales yet simply has
// an empty series, which the screen renders as such.

import { apiGet } from '../lib/api.js';
import { canAccessStore } from './storeService';

const iso = (d) => d.toISOString().slice(0, 10);

/** The last `days` days ending today, as an inclusive ISO range. */
function recentRange(days = 14) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { startDate: iso(start), endDate: iso(end) };
}

function assertScope(user, storeId) {
  const scopedStoreId = storeId ?? user?.storeId;
  if (!canAccessStore(user, scopedStoreId)) throw new Error('ไม่มีสิทธิ์เข้าถึงข้อมูลสาขานี้');
  return scopedStoreId;
}

const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
const baht = (n) => `฿${Math.round(n).toLocaleString()}`;

/**
 * Headline stats, the hour-of-day breakdown, and the recent trend.
 *
 * The hourly breakdown is the forecast's hourly split — the system has no
 * per-hour ACTUAL sales anywhere (sales_by_hour is aggregated per month, with no
 * date), so this is labelled as a forecast rather than presented as what the
 * store actually took hour by hour.
 */
export const getSalesOverview = async (user, storeId) => {
  const scopedStoreId = assertScope(user, storeId);
  const { startDate, endDate } = recentRange(14);
  const query = new URLSearchParams({ storeId: scopedStoreId, startDate, endDate }).toString();

  const [actual, hourly] = await Promise.all([
    apiGet(`/sales?storeId=${encodeURIComponent(scopedStoreId)}&from=${startDate}&to=${endDate}`).catch(() => []),
    apiGet(`/forecast/hourly/preview?${query}`).catch(() => null),
  ]);

  const total = sum(actual, 'amount');
  const days = actual.length;
  const hours = new Map();
  for (const day of hourly?.days ?? []) {
    for (const h of day.hours) hours.set(h.hour, (hours.get(h.hour) || 0) + h.forecastedSales);
  }

  return {
    stats: [
      { id: 'total', label: 'ยอดขายรวม 14 วัน', value: baht(total) },
      { id: 'average', label: 'เฉลี่ยต่อวัน', value: days ? baht(total / days) : '—' },
      { id: 'days', label: 'จำนวนวันที่มีข้อมูล', value: String(days) },
    ],
    hours: [...hours.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, value]) => ({ id: `h${hour}`, label: `${String(hour).padStart(2, '0')}:00`, value: Math.round(value) })),
    trend: actual.map((row) => ({ label: String(row.sales_date).slice(5), value: Number(row.amount) || 0 })),
  };
};

/** Reported daily sales rows for the store, most recent first. */
export const getDailySales = async (user, storeId) => {
  const scopedStoreId = assertScope(user, storeId);
  const { startDate, endDate } = recentRange(30);
  const rows = await apiGet(
    `/sales?storeId=${encodeURIComponent(scopedStoreId)}&from=${startDate}&to=${endDate}`
  ).catch(() => []);
  return [...rows].sort((a, b) => String(b.sales_date).localeCompare(String(a.sales_date)));
};

/**
 * Recording a day's sales by hand is not available from this screen.
 *
 * Sales reach the system through the Excel import (POST /sales-report/import),
 * which is the audited path the whole forecast is built on. There is no
 * single-day write endpoint, and inventing one here would create figures the
 * import can then silently overwrite.
 */
export const submitDailySales = async () => {
  throw new Error('บันทึกยอดขายรายวันจากหน้านี้ยังไม่รองรับ — นำเข้าผ่านไฟล์ Excel ที่หน้า "นำเข้าข้อมูล" แทน');
};
