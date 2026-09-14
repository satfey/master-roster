/**
 * Roster quality evaluator — answers the 9 "is this roster actually good" questions numerically,
 * for real stores against the real forecast.
 *
 * READ-ONLY: runs the real generateDraftRoster with only the persistence boundary redirected into
 * memory, so every scheduling decision is production code and nothing is written to the database.
 *
 * The key metric is DEMAND ALIGNMENT, not constraint satisfaction. Constraints passing is Tier 1;
 * this measures Tier 2 and Tier 3.
 */
require('dotenv').config();

const rosterRepo = require('../src/repositories/rosterRepository');
const forecastRepo = require('../src/repositories/forecastRepository');
const { employeeShiftType } = require('../src/services/employeeShiftRules');
const { OPERATING_HOURS, CLOSING_COVERAGE_STAFF_COUNT } = require('../src/services/storeOperatingHours');

let captured = [];
let employeesById = new Map();
rosterRepo.findOrCreateRoster = async ({ storeId, weekStart }) => ({ id: `mem-${storeId}-${weekStart}`, store_id: storeId, week_start: weekStart, status: 'DRAFT' });
rosterRepo.deleteShiftsForRosterInRange = async () => {};
rosterRepo.insertShifts = async (rows) => {
  captured.push(...rows);
  return rows.map((r, i) => ({ id: `mem-${i}`, ...r }));
};
rosterRepo.findShiftsForStoreInRange = async (storeId, from, to) =>
  captured
    .filter((s) => s.shift_date >= from && s.shift_date <= to)
    .map((s) => ({ ...s, employee: employeesById.get(s.employee_id) || null, roster: { store_id: storeId, status: 'DRAFT' } }));

const forecastRows = [];
forecastRepo.createModelRun = async () => ({ id: 'mem-run' });
forecastRepo.upsertForecastRows = async (rows) => {
  forecastRows.push(...rows);
  return rows;
};
forecastRepo.findForecastRows = async ({ storeId, startDate, endDate, hourly }) =>
  forecastRows.filter(
    (r) => r.store_id === storeId && r.forecast_date >= startDate && r.forecast_date <= endDate && (hourly ? r.daypart !== 'FULL_DAY' : r.daypart === 'FULL_DAY')
  );

const { generateDraftRoster, isManagerRole } = require('../src/services/rosterGenerationService');

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dowOf = (d) => DOW[new Date(`${d}T00:00:00Z`).getUTCDay()];
const isWeekend = (d) => ['Sat', 'Sun'].includes(dowOf(d));

function coverageAt(shifts, date, hour) {
  return shifts.filter((s) => {
    if (s.shift_date !== date) return false;
    const start = Number(s.start_time.slice(0, 2));
    const end = Number(s.end_time.slice(0, 2));
    if (!(start <= hour && hour < end)) return false;
    if (s.break_start_time && Number(s.break_start_time.slice(0, 2)) === hour) return false;
    return true;
  }).length;
}

/** Pearson correlation — how closely one series tracks another. */
function correlation(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}

async function evaluate(storeId, startDate, endDate) {
  captured = [];
  forecastRows.length = 0;
  const employees = await rosterRepo.findActiveEmployees(storeId);
  employeesById = new Map(employees.map((e) => [e.id, e]));
  const typeOf = new Map(employees.map((e) => [e.id, employeeShiftType(e)]));
  const mgrIds = new Set(employees.filter((e) => employeeShiftType(e) === 'FULL_TIME' && isManagerRole(e)).map((e) => e.id));
  const ftIds = employees.filter((e) => employeeShiftType(e) === 'FULL_TIME').map((e) => e.id);
  if (ftIds.length === 0) return null;

  const result = await generateDraftRoster({ storeId, startDate, endDate, regenerate: true });
  const shifts = captured;

  const days = result.laborDemand.days.map((d) => {
    const sales = d.hours.reduce((s, h) => s + h.forecastedSales, 0);
    const onDuty = new Set(shifts.filter((s) => s.shift_date === d.date).map((s) => s.employee_id));
    const hours = shifts.filter((s) => s.shift_date === d.date).reduce((s, x) => s + Number(x.planned_hours), 0);
    return {
      date: d.date,
      dow: dowOf(d.date),
      sales,
      hours,
      ft: [...onDuty].filter((id) => typeOf.get(id) === 'FULL_TIME').length,
      pt: [...onDuty].filter((id) => typeOf.get(id) === 'PART_TIME').length,
      mgr: [...onDuty].filter((id) => mgrIds.has(id)).length,
      hourRows: d.hours.map((h) => ({
        hour: h.hour,
        sales: h.forecastedSales,
        required: h.requiredHeadcount,
        ceiling: h.maxJustifiedHeadcount,
        scheduled: coverageAt(shifts, d.date, h.hour),
      })),
    };
  });

  return { storeId, days, ftCount: ftIds.length, mgrCount: mgrIds.size, ftIds, mgrIds, shifts, warnings: result.warnings, validation: result.validation };
}

function score(runs) {
  const allDays = runs.flatMap((r) => r.days);
  const allHours = allDays.flatMap((d) => d.hourRows);
  const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');

  // Q8 — does scheduled manpower follow the sales curve?
  const dayCorrs = runs.map((r) => correlation(r.days.map((d) => d.sales), r.days.map((d) => d.hours))).filter((c) => c !== null);
  const hourCorrs = runs.flatMap((r) => r.days.map((d) => correlation(d.hourRows.map((h) => h.sales), d.hourRows.map((h) => h.scheduled)))).filter((c) => c !== null);
  const mean = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);

  // Q1 — FT coverage on high vs low sales days (per store, top-2 vs bottom-2 days)
  let ftHigh = 0;
  let ftLow = 0;
  let mgrHigh = 0;
  let mgrLow = 0;
  for (const r of runs) {
    const sorted = [...r.days].sort((a, b) => a.sales - b.sales);
    const low = sorted.slice(0, 2);
    const high = sorted.slice(-2);
    ftLow += mean(low.map((d) => d.ft));
    ftHigh += mean(high.map((d) => d.ft));
    mgrLow += mean(low.map((d) => d.mgr));
    mgrHigh += mean(high.map((d) => d.mgr));
  }

  // Q2/Q3 — designated rest days (FT that worked exactly 6 of 7)
  const rests = [];
  for (const r of runs) {
    const byDemandAsc = [...r.days].sort((a, b) => a.sales - b.sales).map((d) => d.date);
    for (const id of r.ftIds) {
      const worked = new Set(r.shifts.filter((s) => s.employee_id === id).map((s) => s.shift_date));
      const off = r.days.map((d) => d.date).filter((d) => !worked.has(d));
      if (off.length !== 1) continue;
      rests.push({ date: off[0], rank: byDemandAsc.indexOf(off[0]) + 1, weekend: isWeekend(off[0]), manager: r.mgrIds.has(id) });
    }
  }

  // Q4/Q7 — hourly alignment, split by sales quartile
  const sortedHours = [...allHours].sort((a, b) => b.sales - a.sales);
  const q = Math.ceil(sortedHours.length / 4);
  const topQ = sortedHours.slice(0, q);
  const botQ = sortedHours.slice(-q);
  const shortfall = (l) => l.reduce((s, h) => s + Math.max(0, h.ceiling - h.scheduled), 0);
  const excess = (l) => l.reduce((s, h) => s + Math.max(0, h.scheduled - h.ceiling), 0);
  // Excess at the opening hour and the closing hour is MANDATORY: OPEN>=1 and CLOSE>=2 are Tier-1
  // constraints that outrank demand efficiency, and several stores have no sales_by_hour history
  // at 21:00 at all, so their forecast reads zero there while the store is still open and legally
  // needs two closers. Counting that as waste would be measuring the hierarchy working correctly.
  const isMandatoryHour = (h) => h.hour === OPERATING_HOURS.start || h.hour >= OPERATING_HOURS.end - 2;
  const mandatoryExcess = (l) => excess(l.filter(isMandatoryHour));
  const discretionaryExcess = (l) => excess(l.filter((h) => !isMandatoryHour(h)));

  // Q9 — hard constraints
  const openOk = allDays.every((d) => d.hourRows.find((h) => h.hour === OPERATING_HOURS.start).scheduled >= 1);
  const midOk = allHours.every((h) => h.scheduled >= 1);
  const closeOk = runs.every((r) =>
    r.days.every((d) => new Set(r.shifts.filter((s) => s.shift_date === d.date && s.end_time === '22:00').map((s) => s.employee_id)).size >= CLOSING_COVERAGE_STAFF_COUNT)
  );

  console.log(`\n════════ ROSTER QUALITY — ${runs.length} stores, ${allDays.length} store-days ════════`);
  console.log(`Q1 FT on high-sales days vs low       : ${(ftHigh / runs.length).toFixed(2)} vs ${(ftLow / runs.length).toFixed(2)}  ${ftHigh >= ftLow ? 'OK' : 'FAIL'}`);
  console.log(`Q2 rest days on 3 quietest days       : ${rests.filter((r) => r.rank <= 3).length}/${rests.length} (${pct(rests.filter((r) => r.rank <= 3).length, rests.length)})`);
  console.log(`Q3 rest days on a weekend             : ${rests.filter((r) => r.weekend).length}/${rests.length}`);
  console.log(`Q4 top-quartile hour shortfall        : ${shortfall(topQ)} person-hours below the justified ceiling`);
  console.log(`Q5 Manager present, high vs low days  : ${(mgrHigh / runs.length).toFixed(2)} vs ${(mgrLow / runs.length).toFixed(2)}  ${mgrHigh >= mgrLow ? 'OK' : 'FAIL'}`);
  console.log(`   Manager rest days on a weekend     : ${rests.filter((r) => r.manager && r.weekend).length}/${rests.filter((r) => r.manager).length}`);
  console.log(`Q6 PT hours / total hours             : ${pct(allDays.reduce((s, d) => s + d.pt, 0), allDays.reduce((s, d) => s + d.ft + d.pt, 0))} of bodies`);
  console.log(`Q7 bottom-quartile hour EXCESS        : ${excess(botQ)} person-hours above the justified ceiling`);
  console.log(`   ...at open/close hours (MANDATORY) : ${mandatoryExcess(botQ)}`);
  console.log(`   ...mid-day (genuinely discretionary): ${discretionaryExcess(botQ)}`);
  console.log(`   whole-week excess, all hours       : ${excess(allHours)}  (mandatory ${mandatoryExcess(allHours)}, discretionary ${discretionaryExcess(allHours)})`);
  console.log(`Q8 DAILY  hours-vs-sales correlation  : ${mean(dayCorrs).toFixed(3)}   (1.0 = perfectly follows the curve)`);
  console.log(`   HOURLY headcount-vs-sales corr.    : ${mean(hourCorrs).toFixed(3)}`);
  console.log(`Q9 OPEN>=1 ${openOk ? 'OK' : 'FAIL'}   MID>=1 ${midOk ? 'OK' : 'FAIL'}   CLOSE>=2 ${closeOk ? 'OK' : 'FAIL'}`);
  console.log(`   total understaffed hours           : ${allHours.filter((h) => h.scheduled < h.required).length}`);
  return { dayCorr: mean(dayCorrs), hourCorr: mean(hourCorrs), topShortfall: shortfall(topQ), botExcess: excess(botQ) };
}

(async () => {
  const START = process.env.Q_START || '2026-09-21';
  const END = process.env.Q_END || '2026-09-27';
  const STORES = (process.env.Q_STORES || '1215,1508,1311,413286,1441,1020,1453,1531,1138,413285').split(',');
  const runs = [];
  for (const storeId of STORES) {
    try {
      const r = await evaluate(storeId, START, END);
      if (r) runs.push(r);
    } catch (err) {
      console.log(`store ${storeId}: SKIPPED — ${err.message}`);
    }
  }
  if (process.env.Q_HOURLY === '1') {
    for (const r of runs.slice(0, 1)) {
      const sorted = [...r.days].sort((a, b) => a.sales - b.sales);
      for (const [tag, d] of [['QUIETEST', sorted[0]], ['BUSIEST', sorted[sorted.length - 1]]]) {
        console.log(`
store ${r.storeId}  ${tag} day ${d.date} ${d.dow}  sales ${Math.round(d.sales).toLocaleString()}  (${d.hours}h, FT=${d.ft} PT=${d.pt})`);
        console.log('  hour   sales  req  ceiling  sched   short  excess');
        for (const h of d.hourRows) {
          const short = Math.max(0, h.ceiling - h.scheduled);
          const exc = Math.max(0, h.scheduled - h.ceiling);
          console.log(`  ${String(h.hour).padStart(2,'0')}:00 ${String(Math.round(h.sales).toLocaleString()).padStart(7)} ${String(h.required).padStart(4)} ${String(h.ceiling).padStart(8)} ${String(h.scheduled).padStart(6)} ${String(short||'').padStart(7)} ${String(exc||'').padStart(7)}`);
        }
      }
      console.log('  shifts on the busiest day:');
      const busiest = sorted[sorted.length-1];
      r.shifts.filter((x) => x.shift_date === busiest.date).sort((a,b)=>a.start_time.localeCompare(b.start_time))
        .forEach((x) => console.log(`    ${x.employee_id.padEnd(10)} ${x.start_time}-${x.end_time}  ${x.planned_hours}h  break ${x.break_start_time || '-'}`));
    }
  }
  if (process.env.Q_DETAIL === '1') {
    for (const r of runs.slice(0, 2)) {
      console.log(`\n--- store ${r.storeId} (FT=${r.ftCount}, MGR=${r.mgrCount}) ---`);
      console.log('  dow    sales    hours  FT  PT  MGR');
      for (const d of [...r.days].sort((a, b) => a.sales - b.sales)) {
        console.log(`  ${d.dow}  ${String(Math.round(d.sales).toLocaleString()).padStart(8)}  ${String(d.hours).padStart(6)}  ${String(d.ft).padStart(2)}  ${String(d.pt).padStart(2)}  ${String(d.mgr).padStart(3)}`);
      }
    }
  }
  score(runs);
})();
