import 'dotenv/config';
import * as path from 'path';
import { runImport } from '../src/importer';

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx scripts/import-sales.ts <path-to-excel-file>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  console.log(`Importing sales data from: ${resolvedPath}`);
  await runImport(resolvedPath);
}

main().catch((err) => {
  console.error('Import failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
