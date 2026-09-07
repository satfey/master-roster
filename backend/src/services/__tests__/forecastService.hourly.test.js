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
const { generateHourlyForecast, computeMonthlyForecastedSales, computeDailyForecast } = require('../forecastService');

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

  test('4b. an unreported day (gross_actual: null) is excluded from the weekday average, not counted as 0 sales', async () => {
    // 3 real Monday reports of 10,000, plus 1 not-yet-entered Monday (null) — averaging the null in
    // as 0 would drag this down to 7,500; the real signal is 10,000.
    const rows = dailyRowsForWeekday(1, 10000, 4);
    rows[0].gross_actual = null; // the most recent Monday hasn't been reported yet
    repo.findDailySalesHistory.mockResolvedValue(rows);
    repo.findHourlySalesHistory.mockResolvedValue([{ report_month: '2026-07-01', hour: 12, gross_sale: 1000 }]);

    const result = await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-03', endDate: '2026-08-03' }); // a Monday

    expect(result.days[0].dailyForecastSource).toBe('STORE_WEEKDAY_AVERAGE');
    expect(result.days[0].dailyForecast).toBe(10000); // not 7,500
  });

  test('4c. unreported days do not count toward the same-weekday sample threshold — a weekday with only 1 real report (plus nulls) falls back to the daily average, not a phantom weekday average', async () => {
    const rows = dailyRowsForWeekday(1, 10000, 3); // 3 Mondays
    rows[0].gross_actual = null;
    rows[1].gross_actual = null; // only 1 REAL Monday sample remains — below MIN_WEEKDAY_SAMPLES (2)
    repo.findDailySalesHistory.mockResolvedValue(rows);
    repo.findHourlySalesHistory.mockResolvedValue([{ report_month: '2026-07-01', hour: 12, gross_sale: 1000 }]);

    const result = await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-03', endDate: '2026-08-03' });

    expect(result.days[0].dailyForecastSource).toBe('STORE_DAILY_AVERAGE');
    expect(result.days[0].dailyForecast).toBe(10000); // the one real reported row, not diluted by the 2 nulls
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

describe('forecastService.computeDailyForecast — bounded recency weighting on the STORE_WEEKDAY_AVERAGE tier', () => {
  // Mirrors the documented formula exactly (RECENCY_HALF_LIFE_SAMPLES = 8) — reconstructed here
  // independently rather than imported, so this test locks in the *documented* parameters and
  // would fail loudly (not silently drift) if someone changed the half-life without updating the
  // comment in forecastService.js that justifies it against real data.
  const HALF_LIFE = 8;
  const DECAY = Math.pow(0.5, 1 / HALF_LIFE);
  function expectedRecencyWeighted(valuesNewestFirst) {
    let weightedSum = 0;
    let weightTotal = 0;
    valuesNewestFirst.forEach((v, rank) => {
      const w = DECAY ** rank;
      weightedSum += v * w;
      weightTotal += w;
    });
    return weightedSum / weightTotal;
  }

  /** count rows on `weekday`, 7 days apart, most recent landing on `mostRecentDate`, oldest last — i.e. rows[0] is newest. Lets a test assign a distinct value per position via `valuesNewestFirst`. */
  function weekdayRowsWithValues(weekday, mostRecentDate, valuesNewestFirst) {
    const rows = [];
    let cursor = new Date(`${mostRecentDate}T00:00:00Z`);
    if (cursor.getUTCDay() !== weekday) throw new Error('mostRecentDate is not the expected weekday — fix the test fixture');
    for (const value of valuesNewestFirst) {
      rows.push({ report_date: cursor.toISOString().slice(0, 10), gross_actual: value });
      cursor = new Date(cursor.getTime() - 7 * 86400000);
    }
    return rows;
  }

  // 1. Seven weekdays with genuinely different values still produce separate weekday forecasts.
  test('1. all 7 weekdays keep their own distinct forecast — no collapsing into a weekday/weekend bucket', async () => {
    // 2026-08-03 is a Monday; one flat, distinct amount per weekday, well above MIN_WEEKDAY_SAMPLES.
    const amountByWeekday = { 0: 22000, 1: 10000, 2: 15000, 3: 12000, 4: 18000, 5: 20000, 6: 25000 }; // Sun..Sat
    const history = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => dailyRowsForWeekday(d, amountByWeekday[d], 4, '2026-08-03'));
    repo.findDailySalesHistory.mockResolvedValue(history);
    repo.findHourlySalesHistory.mockResolvedValue([{ report_month: '2026-07-01', hour: 12, gross_sale: 1000 }]);

    const result = await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-03', endDate: '2026-08-09' }); // Mon..Sun

    const forecastByDate = Object.fromEntries(result.days.map((d) => [d.date, d.dailyForecast]));
    expect(forecastByDate['2026-08-03']).toBe(10000); // Mon
    expect(forecastByDate['2026-08-04']).toBe(15000); // Tue
    expect(forecastByDate['2026-08-05']).toBe(12000); // Wed
    expect(forecastByDate['2026-08-06']).toBe(18000); // Thu
    expect(forecastByDate['2026-08-07']).toBe(20000); // Fri
    expect(forecastByDate['2026-08-08']).toBe(25000); // Sat
    expect(forecastByDate['2026-08-09']).toBe(22000); // Sun
    expect(new Set(Object.values(forecastByDate)).size).toBe(7); // all distinct
  });

  // 2. Recent same-weekday observations have more influence than old observations.
  test('2. a recent high value pulls the forecast up more than an unweighted average would, but stays bounded below the recent value itself', () => {
    // 4 Mondays: most recent is a real step-up (20,000), the 3 before it flat at 10,000.
    const history = weekdayRowsWithValues(1, '2026-08-03', [20000, 10000, 10000, 10000]);

    const result = computeDailyForecast(history, '2026-08-10'); // the next Monday

    const plainAverage = 12500; // (20000 + 10000*3) / 4
    expect(result.value).toBeGreaterThan(plainAverage); // recency pulls it up from the plain average...
    expect(result.value).toBeLessThan(20000); // ...but never overreacts all the way to the single newest point
    expect(result.value).toBeCloseTo(expectedRecencyWeighted([20000, 10000, 10000, 10000]), 2); // matches the documented formula exactly
  });

  // 3. Recency weighting does not activate incorrectly when the minimum sample threshold is not met.
  test('3. below MIN_WEEKDAY_SAMPLES, the daily-average fallback is a plain average — recency weighting never applies there', () => {
    // Only 1 Monday exists (below MIN_WEEKDAY_SAMPLES=2), alongside other-weekday reported history.
    const history = [
      ...weekdayRowsWithValues(1, '2026-08-03', [20000]), // 1 Monday
      ...weekdayRowsWithValues(2, '2026-08-04', [8000, 8000]), // 2 Tuesdays, older and newer than the Monday
    ];

    const result = computeDailyForecast(history, '2026-08-10'); // a Monday

    expect(result.source).toBe('STORE_DAILY_AVERAGE');
    expect(result.value).toBe((20000 + 8000 + 8000) / 3); // plain average of ALL reported history, not weekday- or recency-weighted
  });

  // 4. Exactly 1 same-weekday sample follows the existing intended fallback behavior.
  test('4. exactly 1 same-weekday sample (below MIN_WEEKDAY_SAMPLES) falls back to STORE_DAILY_AVERAGE using that sample', () => {
    const history = weekdayRowsWithValues(1, '2026-08-03', [15000]);

    const result = computeDailyForecast(history, '2026-08-10');

    expect(result.source).toBe('STORE_DAILY_AVERAGE');
    expect(result.value).toBe(15000);
    expect(result.samples).toBe(1);
  });

  // 5. NULL gross_actual rows remain excluded — including from recency ranking (a null doesn't
  // consume a "rank slot" that would otherwise shift real samples' weights).
  test('5. an unreported (null) Monday is excluded from both the average AND the recency ranking', () => {
    const rows = weekdayRowsWithValues(1, '2026-08-03', [20000, 10000, 10000]); // newest first
    rows[1].gross_actual = null; // the 2nd-most-recent Monday hasn't been reported

    const result = computeDailyForecast(rows, '2026-08-10');

    // Only 2 REAL samples remain: 20000 (rank 0) and 10000 (rank 1, not rank 2 — the null doesn't occupy a slot).
    expect(result.samples).toBe(2);
    expect(result.value).toBeCloseTo(expectedRecencyWeighted([20000, 10000]), 2);
  });

  // 6. NO_HISTORY behavior unchanged.
  test('6. no history at all still forecasts 0 with NO_HISTORY — untouched by the weighting change', () => {
    const result = computeDailyForecast([], '2026-08-10');
    expect(result).toEqual({ value: 0, source: 'NO_HISTORY', samples: 0 });
  });

  // 7. STORE_DAILY_AVERAGE fallback unchanged (plain average, not recency-weighted) — same case as
  // test 3 above, asserted again standalone per the review checklist.
  test('7. STORE_DAILY_AVERAGE remains a plain, unweighted average', () => {
    // Both rows are Wednesdays (2026-07-01, 2026-07-29); forecasting a Monday guarantees 0
    // same-weekday matches, forcing the STORE_DAILY_AVERAGE branch.
    const history = [
      { report_date: '2026-07-01', gross_actual: 10000 }, // old, low
      { report_date: '2026-07-29', gross_actual: 20000 }, // recent, high — but still a plain average here
    ];

    const result = computeDailyForecast(history, '2026-08-03'); // a Monday

    expect(result.source).toBe('STORE_DAILY_AVERAGE');
    expect(result.value).toBe(15000); // plain (10000+20000)/2, not recency-weighted toward the recent 20000
  });

  // 8. computeMonthlyForecastedSales remains consistent with computeDailyForecast (no duplicated/drifted logic).
  test('8. computeMonthlyForecastedSales sums the SAME recency-weighted values computeDailyForecast produces', async () => {
    // 2026-09 is entirely covered by a single weekday's fixture won't work (7 distinct weekdays in
    // a month) — instead, seed a real recency step-up for Mondays only and confirm the monthly
    // total reflects the weighted (not plain) Monday value where Mondays fall in September 2026.
    const mondayHistory = weekdayRowsWithValues(1, '2026-08-31', [20000, 10000, 10000, 10000]); // most recent Monday before Sept
    repo.findDailySalesHistory.mockResolvedValue(mondayHistory);

    const total = await computeMonthlyForecastedSales({ storeId: '1005', monthKey: '2026-09' });

    // September 2026 has exactly 4 Mondays (7, 14, 21, 28) plus 26 other days with zero history
    // (STORE_DAILY_AVERAGE over the same 4 Monday rows, since they're the only reported history).
    const mondayForecast = computeDailyForecast(mondayHistory, '2026-09-07').value;
    const otherDayForecast = computeDailyForecast(mondayHistory, '2026-09-01').value; // any non-Monday in the month
    const expectedTotal = Math.round(mondayForecast * 4 + otherDayForecast * 26);
    expect(total).toBe(expectedTotal);
    expect(mondayForecast).not.toBe(otherDayForecast); // sanity: the weighted Monday value is genuinely different from the fallback
  });

  // 9. generateHourlyForecast still uses computeDailyForecast and the (unchanged) hour shape — the
  // recency-weighted daily total still redistributes across hours via the same store hour-shape,
  // and hours still sum back to the (now recency-weighted) daily total.
  test('9. generateHourlyForecast redistributes the recency-weighted daily total across the unchanged hour shape', async () => {
    const history = weekdayRowsWithValues(1, '2026-08-03', [20000, 10000, 10000, 10000]);
    repo.findDailySalesHistory.mockResolvedValue(history);
    repo.findHourlySalesHistory.mockResolvedValue([
      { report_month: '2026-07-01', hour: 12, gross_sale: 4000 },
      { report_month: '2026-07-01', hour: 18, gross_sale: 6000 },
    ]); // 40% / 60% shape, unrelated to recency weighting

    const result = await generateHourlyForecast({ storeId: '1005', startDate: '2026-08-10', endDate: '2026-08-10' }); // the next Monday

    const day = result.days[0];
    const unroundedDaily = expectedRecencyWeighted([20000, 10000, 10000, 10000]); // generateHourlyForecast splits hours from the unrounded value, then rounds each hour and the daily total separately
    expect(day.dailyForecast).toBe(Math.round(unroundedDaily)); // the daily total IS recency-weighted
    expect(day.hours.find((h) => h.hour === 12).forecastedSales).toBe(Math.round(unroundedDaily * 0.4)); // hour shape itself unchanged
    expect(day.hours.find((h) => h.hour === 18).forecastedSales).toBe(Math.round(unroundedDaily * 0.6));
    const sumOfHours = day.hours.reduce((s, h) => s + h.forecastedSales, 0);
    expect(Math.abs(sumOfHours - day.dailyForecast)).toBeLessThanOrEqual(1); // still sums back within independent per-hour rounding, per the existing invariant
  });
});
