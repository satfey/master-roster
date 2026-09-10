// Dashboard headline figures, from the real backend.
//
// Every tile here is a number the backend already holds: reported sales
// (sales_report via GET /sales), and the month's labour-hour ceiling and usage
// (GET /roster/capacity). A figure with no backend source is not shown at all
// rather than filled in — the tiles this screen shipped with ("Sales Target
// 556,555", "Productivity 666") were fixed sample values that never moved.

import { apiGet } from '../lib/api.js';

const baht = (n) => `฿${Math.round(n).toLocaleString()}`;
const iso = (d) => d.toISOString().slice(0, 10);

/** Headline tiles for one store, for the current calendar month. */
export const getOverviewMetrics = async (storeId) => {
  if (!storeId) return [];

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const month = iso(monthStart).slice(0, 7);

  const [sales, capacity] = await Promise.all([
    apiGet(`/sales?storeId=${encodeURIComponent(storeId)}&from=${iso(monthStart)}&to=${iso(now)}`).catch(() => []),
    apiGet(`/roster/capacity?storeId=${encodeURIComponent(storeId)}&month=${month}`).catch(() => null),
  ]);

  const actual = sales.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const tiles = [{ id: 'actual', label: 'ยอดขายจริง (เดือนนี้)', value: baht(actual), tone: 'green' }];

  if (capacity?.monthlyGuideline != null) {
    tiles.push({ id: 'quota', label: 'โควตาชั่วโมงแรงงาน/เดือน', value: `${capacity.monthlyGuideline} ชม.`, tone: 'green' });
  }
  if (capacity?.hoursUsedOrCommitted != null) {
    const remaining = capacity.remainingHours;
    tiles.push({
      id: 'used',
      label: 'ชั่วโมงที่ใช้/ผูกไว้แล้ว',
      value: `${capacity.hoursUsedOrCommitted} ชม.`,
      tone: remaining != null && remaining < 0 ? 'red' : 'green',
      delta: remaining != null ? `เหลือ ${remaining} ชม.` : undefined,
    });
  }
  return tiles;
};

/** The store's hour-of-day forecast curve, for the traffic chart. */
export const getHourlyTraffic = async (storeId, date) => {
  if (!storeId) return [];
  const day = date ?? iso(new Date());
  const query = new URLSearchParams({ storeId, startDate: day, endDate: day }).toString();
  try {
    const result = await apiGet(`/forecast/hourly/preview?${query}`);
    return (result.days?.[0]?.hours ?? []).map((h) => ({
      hour: `${String(h.hour).padStart(2, '0')}:00`,
      value: Math.round(h.forecastedSales),
    }));
  } catch {
    return [];
  }
};
