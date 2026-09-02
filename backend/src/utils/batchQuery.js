function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

const DEFAULT_BATCH_SIZE = 100;
// PostgREST caps how many rows a single request returns (this project's default: 1000) —
// confirmed live: a plain .select() against a 100-store batch whose real matching row count
// was 1023 silently came back as exactly 1000, with no error, no truncation flag by default.
// A batch built from DEFAULT_BATCH_SIZE values can easily match more rows than that (e.g. 100
// stores x a year of sales_report rows each), so every batch must be paged through to its real
// end, not just read once — see fetchAllPages below.
const DEFAULT_PAGE_SIZE = 1000;

/**
 * Runs an `.in(column, values)`-filtered Supabase query in batches instead
 * of one request. PostgREST builds `.in(...)` as a literal comma-separated
 * list in the request URL — with hundreds of values (UUIDs at 36 chars
 * each, especially) that URL can exceed the ~16KB header limit enforced by
 * the HTTP client and the server, failing with UND_ERR_HEADERS_OVERFLOW /
 * "HTTP headers exceeded server limits" before the request is even sent.
 *
 * Batches are fired concurrently (Promise.all), not one-at-a-time — each
 * batch is an independent, disjoint read, so there's no ordering
 * dependency between them, only network round-trip latency to pay for
 * every batch. Awaiting them sequentially means that latency is paid once
 * per batch in series (measured: ~2.7s across ~12 batches for a
 * 569-store/6,000-key Sales Report import); running them concurrently
 * pays it roughly once, regardless of batch count. Pages WITHIN a batch,
 * by contrast, are inherently sequential (each page's existence/absence
 * is only known after the previous one comes back), but that's a small
 * cost against the same already-open batch request, not a new round trip
 * per top-level batch.
 *
 * `queryFn(batchOfValues, { from, to })` must apply `.range(from, to)` to
 * the query (in addition to whatever filters the caller needs) and return
 * a Supabase query/promise resolving to `{ data, error }` for that page of
 * that batch; results from every batch/page are concatenated (order
 * doesn't matter — every current caller folds the combined result into a
 * Map or Set). Callers are expected to pass an already deduplicated
 * `values` list (as every current caller does), so batches are disjoint
 * and the combined result contains no duplicates.
 */
async function fetchAllPages(queryFn, batch, pageSize) {
  const results = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryFn(batch, { from, to: from + pageSize - 1 });
    if (error) throw error;
    const page = data || [];
    results.push(...page);
    if (page.length < pageSize) break; // a short page means there's nothing left to fetch for this batch
    from += pageSize;
  }
  return results;
}

async function runInBatches(values, queryFn, batchSize = DEFAULT_BATCH_SIZE, pageSize = DEFAULT_PAGE_SIZE) {
  if (!values.length) return [];

  const perBatchResults = await Promise.all(chunk(values, batchSize).map((batch) => fetchAllPages(queryFn, batch, pageSize)));
  return perBatchResults.flat();
}

module.exports = { chunk, runInBatches, DEFAULT_BATCH_SIZE, DEFAULT_PAGE_SIZE };
