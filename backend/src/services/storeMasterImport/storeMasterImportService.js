const crypto = require('crypto');
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
 * Resolves every distinct Area Coach name referenced in the file to an
 * area_coach row — reusing an existing match (case/whitespace-insensitive),
 * or, when nothing matches, standing in a placeholder id shared by every
 * row naming that same coach (in any casing/whitespace variant), so a name
 * repeated across many rows resolves to exactly one area_coach, never one
 * per row. Nothing is written here — the caller (commitStoreMasterImport)
 * creates the real rows and remaps these placeholders; preview never gets
 * that far, so the placeholder is all it ever sees.
 *
 * The Store Master Excel file is the only source of truth for Area Coach
 * names — none are ever hard-coded in this codebase. An AMBIGUOUS match
 * (2+ existing area_coach rows already share the name — area_coach.name has
 * no unique constraint) is a different kind of problem — the data already
 * contradicts itself — so that still blocks the row rather than guessing
 * which one was meant.
 *
 * Returns a Map of normalizedName -> { id: placeholderId, name } for every
 * name that needs creating.
 */
async function resolveAreaCoaches(rows) {
  const areaCoachMap = await repo.findAreaCoachesByName();
  const pendingByName = new Map();

  for (const row of rows) {
    if (row.areaCoachNameNormalized === null) {
      row.resolvedAreaCoachId = null; // blank Zone Update — documented as "no Area Coach", not an error
      continue;
    }

    const matches = areaCoachMap.get(row.areaCoachNameNormalized) || [];
    if (matches.length === 1) {
      row.resolvedAreaCoachId = matches[0].id;
    } else if (matches.length > 1) {
      row.errors.push('Ambiguous Area Coach');
    } else {
      if (!pendingByName.has(row.areaCoachNameNormalized)) {
        pendingByName.set(row.areaCoachNameNormalized, { id: crypto.randomUUID(), name: row.areaCoachName });
      }
      row.resolvedAreaCoachId = pendingByName.get(row.areaCoachNameNormalized).id;
      row.willCreateAreaCoach = true;
      row.warnings.push(`Area Coach "${row.areaCoachName}" does not exist yet — will be created`);
    }
  }

  return pendingByName;
}

/**
 * Picks the authoritative row out of a group of same-Store-ID rows whose
 * Branch/Area Coach genuinely disagree, using Effective Date: the file
 * represents a store's info as of different months, so the row for the most
 * recent month is the current truth — confirmed business rule (e.g. Store
 * 1370's Area Coach reassignment to Jirasak Bunchui only shows up on its
 * newer-month row). Returns null when recency itself can't be trusted —
 * a row with no parseable Effective Date, or two rows tied on the latest
 * date that still disagree — since guessing wrong there would silently
 * write incorrect Branch/Area Coach data.
 */
function pickMostRecentRow(groupRows) {
  if (groupRows.some((r) => r.effectiveDate == null)) return null;
  const sorted = [...groupRows].sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime());
  const [newest, runnerUp] = sorted;
  if (runnerUp && runnerUp.effectiveDate.getTime() === newest.effectiveDate.getTime() && rowsConflict(newest, runnerUp)) {
    return null;
  }
  return newest;
}

/**
 * Marks every row involved in an intra-file Store ID collision. Rows that
 * agree on Branch and resolved Area Coach are a harmless repeat — only the
 * first occurrence (file order) is treated as the "representative" that
 * actually gets written; the rest are flagged `duplicateInFile` so they
 * resolve to NO_CHANGE without a second write. Rows that disagree are
 * resolved by Effective Date (see pickMostRecentRow) when possible — the
 * most-recent-month row becomes the representative, the rest are
 * `duplicateInFile` (superseded, not an error). Only when recency can't be
 * determined does this remain a hard error requiring manual review, rather
 * than arbitrarily picking one.
 */
function applyDuplicateDetection(rows) {
  const groups = groupByStoreCode(rows);
  const duplicateRowNumbers = new Set();

  for (const groupRows of groups.values()) {
    if (groupRows.length < 2) continue;

    const [first, ...rest] = groupRows;
    const conflicting = rest.some((r) => rowsConflict(first, r));

    if (!conflicting) {
      for (const r of groupRows) duplicateRowNumbers.add(r.rowNumber);
      for (const r of rest) r.duplicateInFile = true;
      continue;
    }

    const winner = pickMostRecentRow(groupRows);
    if (!winner) {
      const rowNumbers = groupRows.map((r) => r.rowNumber).join(', ');
      for (const r of groupRows) {
        r.errors.push(`Conflicting duplicate Store ID "${r.storeCode}" in file (rows ${rowNumbers}): Branch/Area Coach differ and Effective Date does not resolve which is current`);
        duplicateRowNumbers.add(r.rowNumber);
      }
      continue;
    }

    for (const r of groupRows) {
      duplicateRowNumbers.add(r.rowNumber);
      if (r !== winner) r.duplicateInFile = true;
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
  const rows = transformRows(rawRows).map((r) => ({ ...r, resolvedAreaCoachId: null, willCreateAreaCoach: false, duplicateInFile: false, warnings: [] }));

  const pendingAreaCoaches = await resolveAreaCoaches(rows);
  const duplicateRowNumbers = applyDuplicateDetection(rows);

  // A pending (not-yet-existing) Area Coach may have only been referenced by a row that
  // pickMostRecentRow (inside applyDuplicateDetection) just superseded as duplicateInFile —
  // that coach is never actually written, so don't create it. Only keep the ones a still-
  // writable row (no errors, not superseded) actually resolves to.
  const neededAreaCoachIds = new Set(
    rows.filter((r) => r.errors.length === 0 && !r.duplicateInFile && r.resolvedAreaCoachId).map((r) => r.resolvedAreaCoachId)
  );
  for (const [name, placeholder] of pendingAreaCoaches) {
    if (!neededAreaCoachIds.has(placeholder.id)) pendingAreaCoaches.delete(name);
  }

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
      storeId: row.storeCode, // business-facing Store ID (e.g. "1001") — store.id (UUID) is never exposed here
      storeCode: row.storeCode,
      branch: row.branch,
      areaCoachName: row.areaCoachName,
      resolvedAreaCoachId: row.resolvedAreaCoachId,
      willCreateAreaCoach: row.willCreateAreaCoach,
      action,
    };
  });

  return { rows: previewRows, duplicateRowNumbers, storeMap, pendingAreaCoaches };
}

function summarize({ rows, duplicateRowNumbers, pendingAreaCoaches }) {
  const distinctCreate = new Set(rows.filter((r) => r.action === 'CREATE').map((r) => r.storeCode));
  const distinctUpdate = new Set(rows.filter((r) => r.action === 'UPDATE').map((r) => r.storeCode));

  return {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.status === 'valid').length,
    invalidRows: rows.filter((r) => r.status === 'invalid').length,
    duplicateRows: duplicateRowNumbers.size,
    newStoreCount: distinctCreate.size,
    updateStoreCount: distinctUpdate.size,
    newAreaCoachCount: pendingAreaCoaches.size,
    rows,
  };
}

async function previewStoreMasterImport(buffer) {
  return summarize(await evaluateRows(buffer));
}

/**
 * Creates every pending Area Coach for real (bulk, deduped by the caller
 * already) and returns a placeholderId -> realId map, so every row that was
 * assigned a placeholder during evaluateRows can be substituted with the
 * actual area_coach.id before store rows are written.
 */
async function createPendingAreaCoaches(pendingAreaCoaches) {
  const placeholders = [...pendingAreaCoaches.values()];
  if (!placeholders.length) return { remap: new Map(), areaCoachesCreated: [] };

  const created = await repo.createAreaCoaches(placeholders.map((p) => p.name));
  const realIdByName = new Map(created.map((c) => [c.name, c.id]));

  const remap = new Map();
  for (const placeholder of placeholders) {
    remap.set(placeholder.id, realIdByName.get(placeholder.name));
  }

  return { remap, areaCoachesCreated: created };
}

async function commitStoreMasterImport(buffer) {
  const { rows, storeMap, pendingAreaCoaches } = await evaluateRows(buffer);

  const { remap: areaCoachRemap, areaCoachesCreated } = await createPendingAreaCoaches(pendingAreaCoaches);
  const resolveFinalAreaCoachId = (id) => (id !== null && areaCoachRemap.has(id) ? areaCoachRemap.get(id) : id);

  const toCreate = rows.filter((r) => r.action === 'CREATE');
  const toUpdate = rows.filter((r) => r.action === 'UPDATE');
  const unchanged = rows.filter((r) => r.action === 'NO_CHANGE');
  const failed = rows.filter((r) => r.status === 'invalid').map((r) => ({ rowNumber: r.rowNumber, storeId: r.storeCode, storeCode: r.storeCode, errors: r.errors }));

  const created = await repo.createStores(toCreate.map((r) => ({ storeCode: r.storeCode, name: r.branch, areaCoachId: resolveFinalAreaCoachId(r.resolvedAreaCoachId) })));
  const updated = await repo.updateStores(toUpdate.map((r) => ({ id: storeMap.get(r.storeCode).id, name: r.branch, areaCoachId: resolveFinalAreaCoachId(r.resolvedAreaCoachId) })));

  return {
    total: rows.length,
    created: created.length,
    updated: updated.length,
    unchanged: unchanged.length,
    failed,
    storesCreated: created.map((s) => ({ id: s.id, storeId: s.storeCode, storeCode: s.storeCode, name: s.name, area_coach_id: s.area_coach_id })),
    storesUpdated: updated.map((s) => ({ id: s.id, storeId: s.storeCode, storeCode: s.storeCode, name: s.name, area_coach_id: s.area_coach_id })),
    areaCoachesCreated: areaCoachesCreated.map((c) => ({ id: c.id, name: c.name })),
  };
}

module.exports = { previewStoreMasterImport, commitStoreMasterImport };
