import { FailedRow, ImportSummary } from './types';

export function logProgress(current: number, total: number): void {
  const pct = total === 0 ? 100 : Math.round((current / total) * 100);
  process.stdout.write(`\rProcessing row ${current}/${total} (${pct}%)`);
  if (current === total) process.stdout.write('\n');
}

export function logRowError(rowNumber: number, message: string): void {
  console.error(`\n[Row ${rowNumber}] FAILED: ${message}`);
}

export function logSummary(summary: ImportSummary, failedRows: FailedRow[]): void {
  console.log('\n--- Import Summary ---');
  console.log(`Total rows:  ${summary.total}`);
  console.log(`Imported:    ${summary.imported}`);
  console.log(`Failed:      ${summary.failed}`);
  console.log(`Skipped:     ${summary.skipped}`);

  if (failedRows.length > 0) {
    console.log('\nFailed rows:');
    for (const failure of failedRows) {
      console.log(`  Row ${failure.rowNumber}: ${failure.errors.join('; ')}`);
    }
  }
}
