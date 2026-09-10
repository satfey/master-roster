import 'dotenv/config';
import * as path from 'path';
import { buildPreview, runImport } from '../src/importer';
import { logPreviewSummary, logPreviewTable } from '../src/logger';
import { confirm } from '../src/prompt';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const filePath = args.find((arg) => !arg.startsWith('-'));
  const autoConfirm = args.includes('--yes') || args.includes('-y');
  const dryRun = args.includes('--dry-run');

  if (!filePath) {
    console.error('Usage: npx tsx scripts/import-sales.ts <path-to-excel-file> [--yes] [--dry-run]');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  console.log(`Reading sales data from: ${resolvedPath}\n`);

  const preview = await buildPreview(resolvedPath);
  logPreviewTable(preview);
  logPreviewSummary(preview);

  const validCount = preview.filter((row) => row.status === 'valid').length;

  if (dryRun) {
    console.log('Dry run only — no data was sent to the backend.');
    return;
  }

  if (validCount === 0) {
    console.log('No valid rows to import.');
    return;
  }

  if (!autoConfirm) {
    const proceed = await confirm(`Import ${validCount} valid row(s) into the backend?`);
    if (!proceed) {
      console.log('Import cancelled — no data was sent.');
      return;
    }
  }

  await runImport(preview);
}

main().catch((err) => {
  console.error('Import failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
