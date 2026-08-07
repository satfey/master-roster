const supabase = require('../config/supabase');

const CHUNK_SIZE = 500; // keeps each insert within a reasonable request size

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

/**
 * Bulk-inserts records into the given table in chunks. Note: this is not
 * wrapped in a single DB transaction (Supabase's REST client has no
 * client-side multi-statement transaction) — a failure partway through
 * leaves earlier chunks committed. It was never a cross-table transaction
 * (always one table per import run), just batching.
 */
async function bulkInsert(tableName, records) {
  if (records.length === 0) return 0;

  let count = 0;
  for (const batch of chunk(records, CHUNK_SIZE)) {
    const { data, error } = await supabase.from(tableName).insert(batch).select();
    if (error) throw error;
    count += data.length;
  }
  return count;
}

module.exports = { bulkInsert };
