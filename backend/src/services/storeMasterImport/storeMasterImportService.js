const { parseStoreMasterWorkbook } = require('./excelParser');
const { transformRows } = require('./transform');
const repo = require('../../repositories/storeMasterRepository');

function groupByStoreCode(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.storeCode === null) continue;
    if (!groups.has(row.storeCode)) groups.set(row.storeCode, []);
    groups.get(row.storeCode).push(row);
  }
  return groups;
}

/** Two rows for the same Store ID are only safe to collapse into one write if they agree on everything that would be written — a differing Branch or resolved Area Coach is a genuine conflict, not a harmless repeat. */
function rowsConflict(a, b) {
  return a.branch !== b.branch || (a.resolvedAreaCoachId || null) !== (b.resolvedAreaCoachId || null);
}

/**
 * An unmatched Area Coach name is treated as "not assigned yet" rather than
 * a hard failure — the store is still created/updated with area_coach_id =
 * NULL, and a warning is attached so it can be found and fixed later. Once
 * the Area Coach user is added to `users`, re-importing the same file is
 * enough to backfill it (this row's action becomes UPDATE instead of
 * NO_CHANGE). An AMBIGUOUS match is a different kind of problem — the data
 * already contradicts itself — so that still blocks the row rather than
 * guessing which user was meant.
 */
async function resolveAreaCoaches(rows) {
  const areaCoachMap = await repo.findAreaCoachUsersByName();

  for (const row of rows) {
    if (row.areaCoachNameNormalized === null) {
      row.resolvedAreaCoachId = null; // blank Zone Update — documented as "no Area Coach", not an error
      continue;
    }
    const matches = areaCoachMap.get(row.areaCoachNameNormalized) || [];
    if (matches.length === 0) {
      row.warnings.push(`Area Coach "${row.areaCoachName}" not found — saved without an Area Coach`);
    } else if (matches.length > 1) {
      row.errors.push('Ambiguous Area Coach');
    } else {
      row.resolvedAreaCoachId = matches[0].id;
    }
  }
}

/**
 * Marks every row involved in an intra-file Store ID collision. Rows that
 * agree on Branch and resolved Area Coach are a harmless repeat — only the
 * first occurrence (file order) is treated as the "representative" that
 * actually gets written; the rest are flagged `duplicateInFile` so they
 * resolve to NO_CHANGE without a second write. Rows that disagree are a real
 * conflict and are marked invalid instead of arbitrarily picking one.
 */
function applyDuplicateDetection(rows) {
  const groups = groupByStoreCode(rows);
  const duplicateRowNumbers = new Set();

  for (const groupRows of groups.values()) {
    if (groupRows.length < 2) continue;

    const [first, ...rest] = groupRows;
    const conflicting = rest.some((r) => rowsConflict(first, r));

    if (conflicting) {
      const rowNumbers = groupRows.map((r) => r.rowNumber).join(', ');
      for (const r of groupRows) {
        r.errors.push(`Conflicting duplicate Store ID "${r.storeCode}" in file (rows ${rowNumbers}): Branch/Area Coach differ`);
        duplicateRowNumbers.add(r.rowNumber);
      }
    } else {
      for (const r of groupRows) duplicateRowNumbers.add(r.rowNumber);
      for (const r of rest) r.duplicateInFile = true;
    }
  }

  return duplicateRowNumbers;
}

function formatEffectiveDateForDisplay(row) {
  if (row.effectiveDate instanceof Date) return row.effectiveDate.toISOString().slice(0, 10);
  if (row.effectiveDateRaw === null || row.effectiveDateRaw === undefined) return null;
  const str = String(row.effectiveDateRaw).trim();
  return str === '' ? null : str;
}

/** Parses + validates the workbook against the DB. Never writes — used by both preview and commit to plan the same actions. */
async function evaluateRows(buffer) {
  const { rows: rawRows } = await parseStoreMasterWorkbook(buffer);
  const rows = transformRows(rawRows).map((r) => ({ ...r, resolvedAreaCoachId: null, duplicateInFile: false, warnings: [] }));

  await resolveAreaCoaches(rows);
  const duplicateRowNumbers = applyDuplicateDetection(rows);

  const candidateCodes = [...new Set(rows.filter((r) => r.errors.length === 0 && r.storeCode !== null).map((r) => r.storeCode))];
  const storeMap = await repo.findStoresByCodes(candidateCodes);

  const previewRows = rows.map((row) => {
    const status = row.errors.length === 0 ? 'valid' : 'invalid';
    let action = null;

    if (status === 'valid') {
      if (row.duplicateInFile) {
        action = 'NO_CHANGE'; // already handled by this Store ID's first occurrence
      } else {
        const existing = storeMap.get(row.storeCode);
        if (!existing) {
          action = 'CREATE';
        } else {
          const sameName = existing.name === row.branch;
          const sameCoach = (existing.area_coach_id || null) === (row.resolvedAreaCoachId || null);
          action = sameName && sameCoach ? 'NO_CHANGE' : 'UPDATE';
        }
      }
    }

    return {
      rowNumber: row.rowNumber,
      status,
      errors: row.errors,
      warnings: row.warnings,
      effectiveDate: formatEffectiveDateForDisplay(row),
      storeCode: row.storeCode,
      branch: row.branch,
      areaCoachName: row.areaCoachName,
      resolvedAreaCoachId: row.resolvedAreaCoachId,
      action,
    };
  });

  return { rows: previewRows, duplicateRowNumbers, storeMap };
}

function summarize({ rows, duplicateRowNumbers }) {
  const distinctCreate = new Set(rows.filter((r) => r.action === 'CREATE').map((r) => r.storeCode));
  const distinctUpdate = new Set(rows.filter((r) => r.action === 'UPDATE').map((r) => r.storeCode));

  return {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.status === 'valid').length,
    invalidRows: rows.filter((r) => r.status === 'invalid').length,
    duplicateRows: duplicateRowNumbers.size,
    newStoreCount: distinctCreate.size,
    updateStoreCount: distinctUpdate.size,
    rows,
  };
}

async function previewStoreMasterImport(buffer) {
  return summarize(await evaluateRows(buffer));
}

async function commitStoreMasterImport(buffer) {
  const { rows, storeMap } = await evaluateRows(buffer);

  const toCreate = rows.filter((r) => r.action === 'CREATE');
  const toUpdate = rows.filter((r) => r.action === 'UPDATE');
  const unchanged = rows.filter((r) => r.action === 'NO_CHANGE');
  const failed = rows.filter((r) => r.status === 'invalid').map((r) => ({ rowNumber: r.rowNumber, storeCode: r.storeCode, errors: r.errors }));

  const created = await repo.createStores(toCreate.map((r) => ({ storeCode: r.storeCode, name: r.branch, areaCoachId: r.resolvedAreaCoachId })));
  const updated = await repo.updateStores(toUpdate.map((r) => ({ id: storeMap.get(r.storeCode).id, name: r.branch, areaCoachId: r.resolvedAreaCoachId })));

  return {
    total: rows.length,
    created: created.length,
    updated: updated.length,
    unchanged: unchanged.length,
    failed,
    storesCreated: created.map((s) => ({ id: s.id, storeCode: s.storeCode, name: s.name, area_coach_id: s.area_coach_id })),
    storesUpdated: updated.map((s) => ({ id: s.id, storeCode: s.storeCode, name: s.name, area_coach_id: s.area_coach_id })),
  };
}

module.exports = { previewStoreMasterImport, commitStoreMasterImport };
