
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

  const ptIds = new Set(employees.filter((e) => employeeShiftType(e) === 'PART_TIME').map((e) => e.id));
  return { storeId, days, ftCount: ftIds.length, mgrCount: mgrIds.size, ftIds, mgrIds, ptIds, shifts, warnings: result.warnings, validation: result.validation };
}


function reportManagers(runs) {
  let designatedWeekendViolations = 0;
  let atQuota = 0;
  let total = 0;
  let onBusiest = 0;
  let onQuietest = 0;
  let storesWithoutManagerOnBusiest = 0;
  const examples = [];

  for (const r of runs) {
    if (r.mgrIds.size === 0) continue;
    const sorted = [...r.days].sort((a, b) => a.sales - b.sales);
    const busiest = sorted[sorted.length - 1];
    const quietest = sorted[0];
    const workedOn = (id, date) => r.shifts.some((s) => s.employee_id === id && s.shift_date === date);
    const mgrsOnBusiest = [...r.mgrIds].filter((id) => workedOn(id, busiest.date)).length;

    total += r.mgrIds.size;
    onBusiest += mgrsOnBusiest;
    onQuietest += [...r.mgrIds].filter((id) => workedOn(id, quietest.date)).length;
    if (mgrsOnBusiest === 0) storesWithoutManagerOnBusiest++;

    for (const id of r.mgrIds) {
      const worked = new Set(r.shifts.filter((s) => s.employee_id === id).map((s) => s.shift_date));
      const hours = r.shifts.filter((s) => s.employee_id === id).reduce((sum, x) => sum + Number(x.planned_hours), 0);
      if (worked.size === 6 && hours === 48) atQuota++;
      const off = r.days.map((d) => d.date).filter((d) => !worked.has(d));
      if (off.length !== 1) continue; // surplus capacity, not a rest-day choice
      const restDate = off[0];
      const quieterWeekday = r.days.filter((d) => !isWeekend(d.date) && d.sales < r.days.find((x) => x.date === restDate).sales);
      if (isWeekend(restDate) && quieterWeekday.length > 0) {
        designatedWeekendViolations++;
        examples.push(`store ${r.storeId} ${id} off ${restDate} ${dowOf(restDate)} (${quieterWeekday.length} quieter weekdays existed)`);
      }
    }
  }


  let mgrAtQuota = 0;
  let mgrTotal = 0;
  let staffAtQuota = 0;
  let staffTotal = 0;

  const surplusStores = [];

  let peakHourSlots = 0;
  let peakHourWithManager = 0;

  for (const r of runs) {
    if (r.mgrIds.size === 0) continue;
    const hoursOf = (id) => r.shifts.filter((s) => s.employee_id === id).reduce((sum, x) => sum + Number(x.planned_hours), 0);
    const daysOf = (id) => new Set(r.shifts.filter((s) => s.employee_id === id).map((s) => s.shift_date)).size;

    for (const id of r.ftIds) {
      const ok = daysOf(id) === 6 && hoursOf(id) === 48;
      if (r.mgrIds.has(id)) {
        mgrTotal++;
        if (ok) mgrAtQuota++;
      } else {
        staffTotal++;
        if (ok) staffAtQuota++;
      }
    }

    const justified = r.days.reduce((sum, d) => sum + d.hourRows.reduce((a, h) => a + h.ceiling, 0), 0);
    const scheduled = r.shifts.reduce((sum, x) => sum + Number(x.planned_hours), 0);
    const under = r.ftIds.filter((id) => !(daysOf(id) === 6 && hoursOf(id) === 48));
    if (under.length) {
      surplusStores.push({
        storeId: r.storeId,
        under: under.length,
        ft: r.ftIds.length,
        justified,
        scheduled,
        surplus: scheduled >= justified,
      });
    }


    const allHrs = r.days.flatMap((d) => d.hourRows.map((h) => ({ ...h, date: d.date })));
    const cut = [...allHrs].sort((a, b) => b.sales - a.sales).slice(0, Math.ceil(allHrs.length / 4));
    for (const h of cut) {
      peakHourSlots++;
      const covered = [...r.mgrIds].some((id) =>
        r.shifts.some((s) => {
          if (s.employee_id !== id || s.shift_date !== h.date) return false;
          const st = Number(s.start_time.slice(0, 2));
          const en = Number(s.end_time.slice(0, 2));
          if (!(st <= h.hour && h.hour < en)) return false;
          return !(s.break_start_time && Number(s.break_start_time.slice(0, 2)) === h.hour);
        })
      );
      if (covered) peakHourWithManager++;
    }
  }

  const rate = (n, d) => (d ? `${n}/${d} (${Math.round((n / d) * 100)}%)` : 'n/a');

  console.log('   ---- Manager / Team Lead ----');
  console.log(`   M1/M2 high-demand weekend rest (designated) : ${designatedWeekendViolations}`);
  console.log(`   M3 weekend rest rate                       : ${total ? Math.round((designatedWeekendViolations / total) * 100) : 0}%`);
  console.log(`   M4 managers on busiest day                 : ${onBusiest}/${total}   (quietest day: ${onQuietest}/${total})`);
  console.log(`      stores with NO manager on busiest day   : ${storesWithoutManagerOnBusiest}`);
  console.log(`   M5 managers at 6 days / 48h                : ${atQuota}/${total}`);
  console.log(`   M6 CRITICAL weekend rest w/ valid weekday  : ${designatedWeekendViolations}`);
  console.log(`   M7 MANAGER FT 48h compliance               : ${rate(mgrAtQuota, mgrTotal)}`);
  console.log(`   M8 NON-MANAGER FT 48h compliance           : ${rate(staffAtQuota, staffTotal)}`);
  console.log(`   M9 OVERALL FT 48h compliance               : ${rate(mgrAtQuota + staffAtQuota, mgrTotal + staffTotal)}`);
  console.log(`   M10 manager presence, high-demand days     : ${rate(onBusiest, total)}`);
  console.log(`   M11 manager presence, high-demand HOURS    : ${rate(peakHourWithManager, peakHourSlots)}`);
  if (surplusStores.length) {
    console.log('   ---- under-quota Full-time, classified ----');
    for (const s of surplusStores) {
      console.log(
        `      store ${String(s.storeId).padEnd(8)} ${s.under}/${s.ft} FT under quota  scheduled ${s.scheduled}h vs justified ${s.justified}h  -> ${s.surplus ? 'SURPLUS CAPACITY (demand does not justify more FT)' : 'UNDER-STAFFED (investigate)'}`
      );
    }
  }
  examples.slice(0, 5).forEach((e) => console.log(`      ! ${e}`));
}

function score(runs) {
  const allDays = runs.flatMap((r) => r.days);
  const allHours = allDays.flatMap((d) => d.hourRows);
  const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');


  const dayCorrs = runs.map((r) => correlation(r.days.map((d) => d.sales), r.days.map((d) => d.hours))).filter((c) => c !== null);
  const hourCorrs = runs.flatMap((r) => r.days.map((d) => correlation(d.hourRows.map((h) => h.sales), d.hourRows.map((h) => h.scheduled)))).filter((c) => c !== null);
  const mean = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);


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


  const sortedHours = [...allHours].sort((a, b) => b.sales - a.sales);
  const q = Math.ceil(sortedHours.length / 4);
  const topQ = sortedHours.slice(0, q);
  const botQ = sortedHours.slice(-q);
  const shortfall = (l) => l.reduce((s, h) => s + Math.max(0, h.ceiling - h.scheduled), 0);
  const excess = (l) => l.reduce((s, h) => s + Math.max(0, h.scheduled - h.ceiling), 0);

  const isMandatoryHour = (h) => h.hour === OPERATING_HOURS.start || h.hour >= OPERATING_HOURS.end - 2;
  const mandatoryExcess = (l) => excess(l.filter(isMandatoryHour));
  const discretionaryExcess = (l) => excess(l.filter((h) => !isMandatoryHour(h)));


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
  reportManagers(runs);
  const ftHours = runs.reduce((sum, r) => sum + r.shifts.filter((x) => !r.ptIds.has(x.employee_id)).reduce((a, x) => a + Number(x.planned_hours), 0), 0);
  const ptHours = runs.reduce((sum, r) => sum + r.shifts.filter((x) => r.ptIds.has(x.employee_id)).reduce((a, x) => a + Number(x.planned_hours), 0), 0);
  console.log(`Q6 PT hours / total hours             : ${pct(allDays.reduce((s, d) => s + d.pt, 0), allDays.reduce((s, d) => s + d.ft + d.pt, 0))} of bodies`);
  console.log(`   absolute hours                     : FT ${ftHours}h   PT ${ptHours}h   total ${ftHours + ptHours}h`);
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
