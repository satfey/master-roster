const { parseEmployeeMasterWorkbook } = require('./excelParser');
const { transformRows } = require('./transform');
const repo = require('../../repositories/employeeImportRepository');

// Single source of truth for every column this importer writes — used to
// build both the create/update payloads and the NO_CHANGE comparison, so
// the two can never drift out of sync with each other.
const FIELD_MAP = [
  ['title', 'title'],
  ['first_name', 'firstName'],
  ['last_name', 'lastName'],
  ['first_name_local', 'firstNameLocal'],
  ['last_name_local', 'lastNameLocal'],
  ['email', 'email'],
  ['position', 'position'],
  ['position_time_type', 'positionTimeType'],
  ['store_name', 'storeName'],
  ['default_weekly_hours', 'defaultWeeklyHours'],
  ['pay_rate_type', 'payRateType'],
  ['sl_comp_plan', 'slCompPlan'],
  ['sl_comp_amount', 'slCompAmount'],
  ['sl_comp_currency', 'slCompCurrency'],
  ['sl_comp_frequency', 'slCompFrequency'],
  ['hr_comp_plan', 'hrCompPlan'],
  ['hr_comp_amount', 'hrCompAmount'],
  ['hr_comp_currency', 'hrCompCurrency'],
  ['hr_comp_frequency', 'hrCompFrequency'],
];

function normalizeName(value) {
  return value ? value.trim().toLowerCase().replace(/\s+/g, ' ') : null;
}

// The real Employee Master file's Location column holds store.name directly
// (e.g. "DQ1005-CENTER ONE", "DQ413302 - 7-11 THIANTALAY SOI 7") — the same
// "DQ<store.id>-<branch name>" convention store.name itself already follows.
// Confirmed against real Location values: spacing around the dash after the
// id is inconsistent between files ("DQ1144- LAEMTHONG BANGSAEN",
// "DQ413302 - 7-11 ...") and doesn't always match store.name's own spacing
// exactly, so a full-string comparison silently rejects valid rows even
// though the id itself is always reliably present right after "DQ".
function extractStoreIdFromLocationPrefix(value) {
  const match = value ? String(value).trim().match(/^DQ(\d+)/i) : null;
  return match ? match[1] : null;
}

/**
 * Resolves every row's "Location" to a store. Tries, in order: (1) the
 * store.id embedded in a "DQ<id>-..." prefix — the most reliable signal,
 * since it's unaffected by spacing/formatting differences in the branch-name
 * portion; (2) store.id verbatim (a Location that's just the bare id, e.g.
 * "1005"); (3) store.name (case/whitespace-insensitive) for a Location that
 * doesn't follow the DQ-prefix convention at all. Never invents a store or a
 * UUID: no match (or a blank Location) marks the row invalid, since
 * employee.store_id is NOT NULL in the current schema.
 */
async function resolveLocations(rows) {
  const stores = await repo.findAllStores();
  const byId = new Map(stores.map((s) => [s.id, s]));
  const byName = new Map();
  for (const s of stores) {
    const key = normalizeName(s.name);
    if (key && !byName.has(key)) byName.set(key, s);
  }

  for (const row of rows) {
    if (row.storeName === null) {
      row.errors.push('Missing Location');
      continue;
    }
    const prefixId = extractStoreIdFromLocationPrefix(row.storeName);
    const match = (prefixId && byId.get(prefixId)) || byId.get(row.storeName) || byName.get(normalizeName(row.storeName));
    if (!match) {
      row.errors.push(`Unknown Location: "${row.storeName}"`);
    } else {
      row.resolvedStoreId = match.id;
    }
  }
}

/** Marks every row sharing an Employee ID with another row in the same file as invalid — never silently picks one when the same source identity appears twice. */
function markInFileDuplicates(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.employeeId === null) continue;
    if (!groups.has(row.employeeId)) groups.set(row.employeeId, []);
    groups.get(row.employeeId).push(row);
  }

  for (const groupRows of groups.values()) {
    if (groupRows.length < 2) continue;
    const rowNumbers = groupRows.map((r) => r.rowNumber).join(', ');
    for (const r of groupRows) r.errors.push(`Duplicate Employee ID "${r.employeeId}" in file (rows ${rowNumbers})`);
  }
}

function fieldsEqual(existing, row) {
  return FIELD_MAP.every(([dbColumn, rowField]) => (existing[dbColumn] ?? null) === (row[rowField] ?? null))
    && (existing.store_id ?? null) === (row.resolvedStoreId ?? null);
}

/** Parses + validates the workbook against the DB. Never writes — used by both preview and commit to plan the same actions. */
async function evaluateRows(buffer) {
  const { rows: rawRows } = await parseEmployeeMasterWorkbook(buffer);
  const rows = transformRows(rawRows).map((r) => ({ ...r, resolvedStoreId: null }));

  await resolveLocations(rows);
  markInFileDuplicates(rows);

  const employeeIds = [...new Set(rows.filter((r) => r.employeeId !== null).map((r) => r.employeeId))];
  const existingMap = await repo.findEmployeesByIds(employeeIds);

  const previewRows = rows.map((row) => {
    const status = row.errors.length === 0 ? 'valid' : 'invalid';
    let action = null;

    if (status === 'valid') {
      const existing = existingMap.get(row.employeeId);
      if (!existing) {
        action = 'CREATE';
      } else {
        action = fieldsEqual(existing, row) ? 'NO_CHANGE' : 'UPDATE';
      }
    }

    return {
      rowNumber: row.rowNumber,
      status,
      errors: row.errors,
      employeeId: row.employeeId,
      title: row.title,
      firstName: row.firstName,
      lastName: row.lastName,
      firstNameLocal: row.firstNameLocal,
      lastNameLocal: row.lastNameLocal,
      email: row.email,
      position: row.position,
      positionTimeType: row.positionTimeType,
      storeName: row.storeName, // raw "Location" text, as-is
      resolvedStoreId: row.resolvedStoreId,
      defaultWeeklyHours: row.defaultWeeklyHours,
      payRateType: row.payRateType,
      slCompPlan: row.slCompPlan,
      slCompAmount: row.slCompAmount,
      slCompCurrency: row.slCompCurrency,
      slCompFrequency: row.slCompFrequency,
      hrCompPlan: row.hrCompPlan,
      hrCompAmount: row.hrCompAmount,
      hrCompCurrency: row.hrCompCurrency,
      hrCompFrequency: row.hrCompFrequency,
      action,
    };
  });

  return { rows: previewRows, existingMap };
}

function buildPayload(row) {
  const payload = { store_id: row.resolvedStoreId };
  for (const [dbColumn, rowField] of FIELD_MAP) payload[dbColumn] = row[rowField];
  return payload;
}

function summarize(rows) {
  const distinctCreate = new Set(rows.filter((r) => r.action === 'CREATE').map((r) => r.employeeId));
  const distinctUpdate = new Set(rows.filter((r) => r.action === 'UPDATE').map((r) => r.employeeId));
  const distinctUnchanged = new Set(rows.filter((r) => r.action === 'NO_CHANGE').map((r) => r.employeeId));

  return {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.status === 'valid').length,
    invalidRows: rows.filter((r) => r.status === 'invalid').length,
    newEmployeeCount: distinctCreate.size,
    updateEmployeeCount: distinctUpdate.size,
    unchangedEmployeeCount: distinctUnchanged.size,
    rows,
  };
}

async function previewEmployeeImport(buffer) {
  const { rows } = await evaluateRows(buffer);
  return summarize(rows);
}

async function commitEmployeeImport(buffer) {
  const { rows } = await evaluateRows(buffer);

  const toCreate = rows.filter((r) => r.action === 'CREATE');
  const toUpdate = rows.filter((r) => r.action === 'UPDATE');
  const unchanged = rows.filter((r) => r.action === 'NO_CHANGE');
  const failed = rows.filter((r) => r.status === 'invalid').map((r) => ({ rowNumber: r.rowNumber, employeeId: r.employeeId, errors: r.errors }));

  const created = await repo.createEmployees(
    toCreate.map((r) => ({ id: r.employeeId, is_active: true, ...buildPayload(r) })),
  );

  const now = new Date().toISOString();
  const updated = await repo.updateEmployees(
    toUpdate.map((r) => ({ id: r.employeeId, updated_at: now, ...buildPayload(r) })),
  );

  const describe = (e) => ({ id: e.id, employeeId: e.id, name: [e.first_name, e.last_name].filter(Boolean).join(' ') || null });

  return {
    total: rows.length,
    created: created.length,
    updated: updated.length,
    unchanged: unchanged.length,
    failed,
    employeesCreated: created.map(describe),
    employeesUpdated: updated.map(describe),
  };
}

module.exports = { previewEmployeeImport, commitEmployeeImport };
