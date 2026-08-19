function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * Runs an `.in(column, values)`-filtered Supabase query in batches instead
 * of one request. PostgREST builds `.in(...)` as a literal comma-separated
 * list in the request URL — with hundreds of values (UUIDs at 36 chars
 * each, especially) that URL can exceed the ~16KB header limit enforced by
 * the HTTP client and the server, failing with UND_ERR_HEADERS_OVERFLOW /
 * "HTTP headers exceeded server limits" before the request is even sent.
 *
 * `queryFn(batchOfValues)` must return a Supabase query/promise resolving
 * to `{ data, error }` for that batch; results from every batch are
 * concatenated in order. Callers are expected to pass an already
 * deduplicated `values` list (as every current caller does), so batches
 * are disjoint and the combined result contains no duplicates.
 */
async function runInBatches(values, queryFn, batchSize = DEFAULT_BATCH_SIZE) {
  if (!values.length) return [];

  const results = [];
  for (const batch of chunk(values, batchSize)) {
    const { data, error } = await queryFn(batch);
    if (error) throw error;
    results.push(...(data || []));
  }
  return results;
}

module.exports = { chunk, runInBatches, DEFAULT_BATCH_SIZE };
