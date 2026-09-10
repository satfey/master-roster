import { createOrUpdateStore, importSalesRecord } from './api';
import { isRowEmpty, readExcelRows } from './excel';
import { logProgress, logRowError, logSummary } from './logger';
import { mapToSalesRecordPayload, mapToStorePayload } from './mapper';
import { parseRow } from './parser';
import { FailedRow, ImportSummary, PreviewRow } from './types';

/** Reads and validates the whole file without sending anything to the backend. */
export async function buildPreview(filePath: string): Promise<PreviewRow[]> {
  const { rows } = await readExcelRows(filePath);
  const preview: PreviewRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // +1 for the header row, +1 to make it 1-indexed
    const rawRow = rows[i];

    if (isRowEmpty(rawRow)) {
      preview.push({ rowNumber, status: 'skipped', data: null, errors: [] });
      continue;
    }

    const { data, errors } = parseRow(rawRow);
    preview.push({ rowNumber, status: errors.length > 0 ? 'invalid' : 'valid', data, errors });
  }

  return preview;
}

/** Sends every 'valid' row from a previously built preview to the backend. */
export async function runImport(preview: PreviewRow[]): Promise<void> {
  const validRows = preview.filter((r) => r.status === 'valid');

  const summary: ImportSummary = {
    total: preview.length,
    imported: 0,
    failed: preview.filter((r) => r.status === 'invalid').length,
    skipped: preview.filter((r) => r.status === 'skipped').length,
  };

  const failedRows: FailedRow[] = preview
    .filter((r) => r.status === 'invalid')
    .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors }));

  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i];
    const data = row.data as NonNullable<PreviewRow['data']>;
    logProgress(i + 1, validRows.length);

    try {
      await createOrUpdateStore(mapToStorePayload(data));
      await importSalesRecord(mapToSalesRecordPayload(data));
      summary.imported++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.failed++;
      failedRows.push({ rowNumber: row.rowNumber, errors: [message] });
      logRowError(row.rowNumber, message);
    }
  }

  logSummary(summary, failedRows);
}
