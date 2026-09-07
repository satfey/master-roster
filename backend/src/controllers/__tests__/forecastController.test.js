jest.mock('../../config/supabase', () => ({})); // forecastService.js requires this directly at module load

jest.mock('../../repositories/forecastRepository', () => ({
  findDailySalesHistory: jest.fn(),
}));
const forecastRepo = require('../../repositories/forecastRepository');
const { previewDailyForecast } = require('../forecastController');

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('forecastController.previewDailyForecast', () => {
  test('storeId is required', async () => {
    const res = makeRes();
    await previewDailyForecast({ query: { startDate: '2026-10-01', endDate: '2026-10-05' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(forecastRepo.findDailySalesHistory).not.toHaveBeenCalled();
  });

  test('startDate and endDate are required', async () => {
    const res = makeRes();
    await previewDailyForecast({ query: { storeId: '1001' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(forecastRepo.findDailySalesHistory).not.toHaveBeenCalled();
  });

  // Regression: 'aaa' < 'zzz' as plain strings, so a naive startDate > endDate check alone lets
  // this through — it used to reach forecastRepo.findDailySalesHistory and fail as a raw 500 from
  // the database ('invalid input syntax for type date: "aaa"') instead of a clean validation error.
  test('regression: a non-date string that sorts before another non-date string is rejected with 400, never reaches the database', async () => {
    const res = makeRes();
    await previewDailyForecast({ query: { storeId: '1001', startDate: 'aaa', endDate: 'zzz' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining('valid dates') }));
    expect(forecastRepo.findDailySalesHistory).not.toHaveBeenCalled();
  });

  test('a date matching the YYYY-MM-DD shape but not a real calendar date (e.g. Feb 30) is rejected with 400', async () => {
    const res = makeRes();
    await previewDailyForecast({ query: { storeId: '1001', startDate: '2026-02-30', endDate: '2026-03-05' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(forecastRepo.findDailySalesHistory).not.toHaveBeenCalled();
  });

  test('startDate after endDate is rejected with 400', async () => {
    const res = makeRes();
    await previewDailyForecast({ query: { storeId: '1001', startDate: '2026-10-10', endDate: '2026-10-01' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(forecastRepo.findDailySalesHistory).not.toHaveBeenCalled();
  });

  test('a valid request returns one entry per date, computed via the real computeDailyForecast', async () => {
    forecastRepo.findDailySalesHistory.mockResolvedValue([
      { report_date: '2026-09-24', gross_actual: 10000 }, // a Thursday, more recent
      { report_date: '2026-09-17', gross_actual: 12000 }, // a Thursday, older
    ]);
    const res = makeRes();

    await previewDailyForecast({ query: { storeId: '1001', startDate: '2026-10-01', endDate: '2026-10-01' } }, res); // also a Thursday

    expect(res.status).not.toHaveBeenCalledWith(400);
    // 10,957, not the plain average (11,000) — computeDailyForecast recency-weights the
    // STORE_WEEKDAY_AVERAGE tier (RECENCY_HALF_LIFE_SAMPLES=8 in forecastService.js), so the more
    // recent 10,000 counts slightly more than the older 12,000.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: { storeId: '1001', days: [{ date: '2026-10-01', forecastedSales: 10957, source: 'STORE_WEEKDAY_AVERAGE', samples: 2 }] },
      })
    );
    expect(forecastRepo.findDailySalesHistory).toHaveBeenCalledWith('1001', { before: '2026-10-01' });
  });

  // Consistency with the 93b7416 fix (forecastService.computeDailyForecast): a not-yet-reported
  // day (gross_actual: null) must never be averaged in as 0 sales, end-to-end through this route.
  test('an unreported day (gross_actual: null) is excluded from the average, matching computeDailyForecast', async () => {
    forecastRepo.findDailySalesHistory.mockResolvedValue([
      { report_date: '2026-09-24', gross_actual: 10000 }, // a Thursday, real
      { report_date: '2026-09-17', gross_actual: null }, // a Thursday, not yet reported
    ]);
    const res = makeRes();

    await previewDailyForecast({ query: { storeId: '1001', startDate: '2026-10-01', endDate: '2026-10-01' } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { storeId: '1001', days: [{ date: '2026-10-01', forecastedSales: 10000, source: 'STORE_DAILY_AVERAGE', samples: 1 }] },
      })
    );
  });

  test('a single findDailySalesHistory call covers the whole date range — no N+1 query per date', async () => {
    forecastRepo.findDailySalesHistory.mockResolvedValue([]);
    const res = makeRes();

    await previewDailyForecast({ query: { storeId: '1001', startDate: '2026-10-01', endDate: '2026-10-10' } }, res);

    expect(forecastRepo.findDailySalesHistory).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0].data.days).toHaveLength(10);
  });
});
