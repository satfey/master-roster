const { chunk, runInBatches, DEFAULT_BATCH_SIZE } = require('../batchQuery');

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
});
