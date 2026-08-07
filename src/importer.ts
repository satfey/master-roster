import { createOrUpdateStore, importSalesRecord } from './api';
import { isRowEmpty, readExcelRows } from './excel';
import { logProgress, logRowError, logSummary } from './logger';
import { mapToSalesRecordPayload, mapToStorePayload } from './mapper';
import { parseRow } from './parser';
import { FailedRow, ImportSummary } from './types';

export async function runImport(filePath: string): Promise<void> {
  const { rows } = readExcelRows(filePath);

  const summary: ImportSummary = { total: rows.length, imported: 0, failed: 0, skipped: 0 };
  const failedRows: FailedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // +1 for the header row, +1 to make it 1-indexed
    const rawRow = rows[i];
    logProgress(i + 1, rows.length);

    if (isRowEmpty(rawRow)) {
      summary.skipped++;
      continue;
    }

    const { data, errors } = parseRow(rawRow);
    if (errors.length > 0) {
      summary.failed++;
      failedRows.push({ rowNumber, errors });
      logRowError(rowNumber, errors.join('; '));
      continue;
    }

    try {
      await createOrUpdateStore(mapToStorePayload(data));
      await importSalesRecord(mapToSalesRecordPayload(data));
      summary.imported++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.failed++;
      failedRows.push({ rowNumber, errors: [message] });
      logRowError(rowNumber, message);
    }
  }

  logSummary(summary, failedRows);
}
