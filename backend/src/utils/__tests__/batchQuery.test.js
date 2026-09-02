const { chunk, runInBatches, DEFAULT_BATCH_SIZE, DEFAULT_PAGE_SIZE } = require('../batchQuery');

describe('chunk', () => {
  test('splits an array into groups of the given size, last group short', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('returns a single chunk when size >= length', () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  test('returns an empty array for empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });
});

describe('runInBatches', () => {
  test('returns [] without calling queryFn when values is empty', async () => {
    const queryFn = jest.fn();
    const result = await runInBatches([], queryFn);
    expect(result).toEqual([]);
    expect(queryFn).not.toHaveBeenCalled();
  });

  test('single batch: calls queryFn once and returns its data', async () => {
    const queryFn = jest.fn().mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null });
    const result = await runInBatches([1, 2], queryFn, 100);
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('multiple batches: concatenates data from every batch', async () => {
    const values = Array.from({ length: 250 }, (_, i) => i);
    const queryFn = jest.fn((batch) => Promise.resolve({ data: batch.map((v) => ({ id: v })), error: null }));
    const result = await runInBatches(values, queryFn, 100);
    expect(queryFn).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(250);
    expect(result.map((r) => r.id).sort((a, b) => a - b)).toEqual(values);
  });

  test('a null/undefined data field on a batch contributes nothing (not a crash)', async () => {
    const queryFn = jest.fn().mockResolvedValue({ data: null, error: null });
    const result = await runInBatches([1, 2, 3], queryFn, 100);
    expect(result).toEqual([]);
  });

  test('throws the error from any batch that returns one', async () => {
    const queryFn = jest.fn()
      .mockResolvedValueOnce({ data: [{ id: 1 }], error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('boom') });
    const values = Array.from({ length: 150 }, (_, i) => i);
    await expect(runInBatches(values, queryFn, 100)).rejects.toThrow('boom');
  });

  test('dispatches all batches concurrently, not one-at-a-time', async () => {
    const values = Array.from({ length: 500 }, (_, i) => i);
    const delayMs = 50;
    const queryFn = jest.fn(
      (batch) => new Promise((resolve) => setTimeout(() => resolve({ data: batch, error: null }), delayMs))
    );

    const start = Date.now();
    await runInBatches(values, queryFn, 100);
    const elapsed = Date.now() - start;

    // 5 batches sequentially would take ~250ms; concurrently it should stay
    // close to a single batch's delay. Generous margin for CI/test jitter.
    expect(queryFn).toHaveBeenCalledTimes(5);
    expect(elapsed).toBeLessThan(delayMs * 3);
  });

  test('uses DEFAULT_BATCH_SIZE (100) when no batchSize is given', async () => {
    const values = Array.from({ length: 101 }, (_, i) => i);
    const queryFn = jest.fn((batch) => Promise.resolve({ data: batch, error: null }));
    await runInBatches(values, queryFn);
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryFn.mock.calls[0][0]).toHaveLength(DEFAULT_BATCH_SIZE);
    expect(queryFn.mock.calls[1][0]).toHaveLength(1);
  });

  // Regression coverage for a real bug found live: PostgREST caps a single response at a
  // default page size (confirmed: exactly 1000 rows returned for a batch whose real matching
  // count was 1023, no error, no truncation flag) — a batch built from up to DEFAULT_BATCH_SIZE
  // (100) filter values can easily match far more rows than that (e.g. 100 stores x a year of
  // daily sales rows each), so a single un-paginated read per batch silently drops the rest.
  describe('pagination within a batch (PostgREST default row-count cap)', () => {
    test('a batch whose real match count exceeds pageSize is fetched in full across multiple pages, not silently truncated', async () => {
      const fullDataset = Array.from({ length: 1023 }, (_, i) => ({ id: i }));
      const queryFn = jest.fn(async (batch, { from, to }) => ({ data: fullDataset.slice(from, to + 1), error: null }));

      const result = await runInBatches([1], queryFn, 100, 1000); // 1 batch, pageSize 1000 (the real PostgREST default)

      expect(result).toHaveLength(1023); // not capped at 1000
      expect(queryFn).toHaveBeenCalledTimes(2); // page 1: rows 0-999 (1000, a full page); page 2: rows 1000-1023 (23, short -> stop)
      expect(queryFn.mock.calls[0][1]).toEqual({ from: 0, to: 999 });
      expect(queryFn.mock.calls[1][1]).toEqual({ from: 1000, to: 1999 });
    });

    test('a batch whose match count is an exact multiple of pageSize still terminates (one short/empty final page, not an infinite loop)', async () => {
      const fullDataset = Array.from({ length: 20 }, (_, i) => ({ id: i }));
      const queryFn = jest.fn(async (batch, { from, to }) => ({ data: fullDataset.slice(from, to + 1), error: null }));

      const result = await runInBatches([1], queryFn, 100, 10); // pageSize 10, dataset is exactly 2 full pages

      expect(result).toHaveLength(20);
      expect(queryFn).toHaveBeenCalledTimes(3); // page1 (10, full) -> page2 (10, full) -> page3 (0, short) -> stop
    });

    test('a batch smaller than pageSize is fetched in exactly one page (no wasted extra request)', async () => {
      const queryFn = jest.fn(async (batch, { from, to }) => ({ data: batch.slice(from, to + 1), error: null }));

      const result = await runInBatches([1, 2, 3], queryFn, 100, 1000);

      expect(result).toEqual([1, 2, 3]);
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    test('multiple top-level batches each paginate independently and correctly', async () => {
      const datasets = { a: Array.from({ length: 15 }, (_, i) => ({ src: 'a', i })), b: Array.from({ length: 5 }, (_, i) => ({ src: 'b', i })) };
      const queryFn = jest.fn(async (batch, { from, to }) => ({ data: datasets[batch[0]].slice(from, to + 1), error: null }));

      const result = await runInBatches(['a', 'b'], queryFn, 1, 10); // batchSize 1 -> 2 separate top-level batches

      expect(result.filter((r) => r.src === 'a')).toHaveLength(15);
      expect(result.filter((r) => r.src === 'b')).toHaveLength(5);
    });

    test('an error on a later page still propagates (not swallowed by the pagination loop)', async () => {
      const queryFn = jest
        .fn()
        .mockResolvedValueOnce({ data: Array.from({ length: 10 }, (_, i) => ({ id: i })), error: null })
        .mockResolvedValueOnce({ data: null, error: new Error('page 2 boom') });

      await expect(runInBatches([1], queryFn, 100, 10)).rejects.toThrow('page 2 boom');
    });

    test('DEFAULT_PAGE_SIZE matches PostgREST\'s real default (1000) and is used when no pageSize is given', async () => {
      expect(DEFAULT_PAGE_SIZE).toBe(1000);

      const queryFn = jest.fn(async () => ({ data: [], error: null }));
      await runInBatches([1], queryFn, 100);
      expect(queryFn.mock.calls[0][1]).toEqual({ from: 0, to: 999 });
    });
  });
});
