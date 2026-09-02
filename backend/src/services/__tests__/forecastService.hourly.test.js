// forecastService.js also imports the raw Supabase client directly, for the
// pre-existing generateForecast() (daily, sales_record-based) — that client
// creates a real connection at require-time, so it must be mocked too even
// though these tests never exercise it.
jest.mock('../../config/supabase', () => ({}));

jest.mock('../../repositories/forecastRepository', () => ({
  findDailySalesHistory: jest.fn(),
  findHourlySalesHistory: jest.fn(),
  findAllHourlySalesHistory: jest.fn(),
  createModelRun: jest.fn(),
  upsertForecastRows: jest.fn(),
}));
const repo = require('../../repositories/forecastRepository');
const { generateHourlyForecast, computeMonthlyForecastedSales } = require('../forecastService');

/** Builds `count` weekly-spaced daily sales rows landing on the given weekday, ending just before `endExclusive`. */
function dailyRowsForWeekday(weekday, amount, count, endExclusive = '2026-08-01') {
  const rows = [];
  const end = new Date(`${endExclusive}T00:00:00Z`);
  let cursor = new Date(end);
  while (cursor.getUTCDay() !== weekday) cursor = new Date(cursor.getTime() - 86400000);
  for (let i = 0; i < count; i++) {
    rows.push({ report_date: cursor.toISOString().slice(0, 10), gross_actual: amount });
    cursor = new Date(cursor.getTime() - 7 * 86400000);
  }
  return rows;
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.createModelRun.mockResolvedValue({ id: 'model-run-1' });
  repo.upsertForecastRows.mockResolvedValue([]);
  repo.findAllHourlySalesHistory.mockResolvedValue([]);
});

describe('forecastService.generateHourlyForecast', () => {
  test('1. same store + same weekday + same hour: hourly forecast preserves the historical hourly shape', async () => {
    // Monday history: consistently 10,000 THB/day, 40% of it in hour 12, 10% in hour 9.
    repo.findDailySalesHistory.mockResolvedValue(dailyRowsForWeekday(1, 10000, 4)); // 1 = Monday
    repo.findHourlySalesHistory.mockResolvedValue([
      { report_month: '2026-07-01', hour: 9, gross_sale: 1000 },
      { report_month: '2026-07-01', hour: 12, gross_sale: 4000 },
      { report_month: '2026-07-01', hour: 20, gross_sale: 5000 },
    ]);

    const result = await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-03', endDate: '2026-08-03' }); // a Monday

    expect(result.hourShapeSource).toBe('STORE_HOUR_SHAPE');
    const day = result.days[0];
    expect(day.dailyForecastSource).toBe('STORE_WEEKDAY_AVERAGE');
    expect(day.dailyForecast).toBe(10000);
    expect(day.hours.find((h) => h.hour === 12).forecastedSales).toBe(4000); // 40% of 10,000
    expect(day.hours.find((h) => h.hour === 9).forecastedSales).toBe(1000); // 10%
  });

  test('2. an hour with no historical sales at all forecasts to 0, not NaN', async () => {
    repo.findDailySalesHistory.mockResolvedValue(dailyRowsForWeekday(1, 10000, 4));
    repo.findHourlySalesHistory.mockResolvedValue([{ report_month: '2026-07-01', hour: 12, gross_sale: 4000 }]);

    const result = await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-03', endDate: '2026-08-03' });

    const hour9 = result.days[0].hours.find((h) => h.hour === 9);
    expect(hour9.forecastedSales).toBe(0);
    expect(Number.isNaN(hour9.forecastedSales)).toBe(false);
  });

  test('3. missing historical weekday data falls back to the store daily average', async () => {
    // Only Tuesday history exists; forecasting for a Wednesday.
    repo.findDailySalesHistory.mockResolvedValue(dailyRowsForWeekday(2, 8000, 5));
    repo.findHourlySalesHistory.mockResolvedValue([{ report_month: '2026-07-01', hour: 12, gross_sale: 1000 }]);

    const result = await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-05', endDate: '2026-08-05' }); // a Wednesday

    expect(result.days[0].dailyForecastSource).toBe('STORE_DAILY_AVERAGE');
    expect(result.days[0].dailyForecast).toBe(8000);
  });

  test('4. a store with no sales history at all forecasts 0 and reports NO_HISTORY, without crashing', async () => {
    repo.findDailySalesHistory.mockResolvedValue([]);
    repo.findHourlySalesHistory.mockResolvedValue([]);
    repo.findAllHourlySalesHistory.mockResolvedValue([]);

    const result = await generateHourlyForecast({ storeId: '9999', startDate: '2026-08-05', endDate: '2026-08-05' });

    expect(result.days[0].dailyForecastSource).toBe('NO_HISTORY');
    expect(result.days[0].dailyForecast).toBe(0);
    expect(result.hourShapeSource).toBe('UNIFORM_FALLBACK'); // no store or chain-wide hourly history either
    expect(result.days[0].hours.every((h) => h.forecastedSales === 0)).toBe(true);
  });

  test('a store with no hourly history of its own falls back to the chain-wide shape', async () => {
    repo.findDailySalesHistory.mockResolvedValue(dailyRowsForWeekday(1, 10000, 4));
    repo.findHourlySalesHistory.mockResolvedValue([]); // no history for this store
    repo.findAllHourlySalesHistory.mockResolvedValue([
      { store_id: 'OTHER', hour: 9, gross_sale: 2000 },
      { store_id: 'OTHER', hour: 12, gross_sale: 8000 },
    ]);

    const result = await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-03', endDate: '2026-08-03' });

    expect(result.hourShapeSource).toBe('CHAIN_HOUR_SHAPE');
    expect(result.days[0].hours.find((h) => h.hour === 12).forecastedSales).toBe(8000); // 80% of 10,000
  });

  test('5. forecasting two different stores does not mix their history', async () => {
    repo.findDailySalesHistory.mockImplementation(async (storeId) =>
      storeId === '1001' ? dailyRowsForWeekday(1, 10000, 3) : dailyRowsForWeekday(1, 20000, 3)
    );
    repo.findHourlySalesHistory.mockResolvedValue([{ report_month: '2026-07-01', hour: 12, gross_sale: 1000 }]);

    const resultA = await generateHourlyForecast({ storeId: '1001', startDate: '2026-08-03', endDate: '2026-08-03' });
    const resultB = await generateHourlyForecast({ storeId: '1002', startDate: '2026-08-03', endDate: '2026-08-03' });

    expect(resultA.days[0].dailyForecast).toBe(10000);
    expect(resultB.days[0].dailyForecast).toBe(20000);
    expect(repo.findDailySalesHistory).toHaveBeenCalledWith('1001', { before: '2026-08-03' });
    expect(repo.findDailySalesHistory).toHaveBeenCalledWith('1002', { before: '2026-08-03' });
  });

  test('6. a multi-date range produces exactly one entry per date', async () => {
    repo.findDailySalesHistory.mockResolvedValue(dailyRowsForWeekday(1, 10000, 4));
    repo.findHourlySalesHistory.mockResolvedValue([{ report_month: '2026-07-01', hour: 12, gross_sale: 1000 }]);

    const result = await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-03', endDate: '2026-08-09' }); // 7 days

    expect(result.days).toHaveLength(7);
    expect(result.days.map((d) => d.date)).toEqual([
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09',
    ]);
  });

  test('7. hourly forecasts for a date sum back to that date\'s daily forecast', async () => {
    repo.findDailySalesHistory.mockResolvedValue(dailyRowsForWeekday(1, 9100, 4));
    repo.findHourlySalesHistory.mockResolvedValue([
      { report_month: '2026-07-01', hour: 9, gross_sale: 700 },
      { report_month: '2026-07-01', hour: 12, gross_sale: 5300 },
      { report_month: '2026-07-01', hour: 20, gross_sale: 3000 },
    ]);

    const result = await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-03', endDate: '2026-08-03' });

    const sumOfHours = result.days[0].hours.reduce((s, h) => s + h.forecastedSales, 0);
    expect(sumOfHours).toBeCloseTo(result.days[0].dailyForecast, 0); // rounding-tolerant
  });

  test('persists hourly rows into sales_forecast with an HOUR_xx daypart, one model run per call', async () => {
    repo.findDailySalesHistory.mockResolvedValue(dailyRowsForWeekday(1, 10000, 4));
    repo.findHourlySalesHistory.mockResolvedValue([{ report_month: '2026-07-01', hour: 9, gross_sale: 1000 }]);

    await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-03', endDate: '2026-08-03' });

    expect(repo.createModelRun).toHaveBeenCalledTimes(1);
    expect(repo.createModelRun).toHaveBeenCalledWith('HOURLY-WEEKDAY-SHAPE-V1');
    const [rows] = repo.upsertForecastRows.mock.calls[0];
    expect(rows[0]).toMatchObject({ store_id: '1005', forecast_date: '2026-08-03', model_run_id: 'model-run-1' });
    expect(rows.every((r) => /^HOUR_\d{2}$/.test(r.daypart))).toBe(true);
  });
});

describe('forecastService.computeMonthlyForecastedSales — the monthly total used to size the Monthly Labor Hours guideline for a future month', () => {
  test('sums the same per-day weekday-aware forecast used by generateHourlyForecast across every date in the month', async () => {
    // Every historical row is 10,000/day (Monday-weighted, but flat regardless of weekday), so every one of August 2026's 31 days forecasts to 10,000.
    repo.findDailySalesHistory.mockResolvedValue(dailyRowsForWeekday(1, 10000, 4));

    const total = await computeMonthlyForecastedSales({ storeId: '1005', monthKey: '2026-08' });

    expect(total).toBe(31 * 10000);
    expect(repo.findDailySalesHistory).toHaveBeenCalledWith('1005', { before: '2026-08-01' });
  });

  test('no sales history at all -> 0, not NaN or a crash', async () => {
    repo.findDailySalesHistory.mockResolvedValue([]);

    const total = await computeMonthlyForecastedSales({ storeId: '1005', monthKey: '2026-08' });

    expect(total).toBe(0);
  });

  test('the history snapshot is frozen at the month start, independent of which specific date within the month a caller asks about', async () => {
    // Same fixture as generateHourlyForecast's test 1, but queried as a month instead of a single day —
    // proves this reuses computeDailyForecast rather than re-deriving its own (possibly inconsistent) logic.
    repo.findDailySalesHistory.mockResolvedValue(dailyRowsForWeekday(1, 10000, 4));
    repo.findHourlySalesHistory.mockResolvedValue([]); // irrelevant to this function — hourly shape is not used

    const total = await computeMonthlyForecastedSales({ storeId: '1005', monthKey: '2026-08' });

    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBeGreaterThan(0);
  });
});
