// Turns the backend's POST /roster/validate response into the rows the
// compliance panel renders.
//
// Every rule lives on the backend (rosterValidationService): opening/closing
// coverage, Full-time 8h + 1h break, the rolling 48-hour week, 6 consecutive
// days, Part-time 4-8h and its break threshold, the 09:00-22:00 shift window,
// double booking, and hour-by-hour under/overstaffing against
// computeHourlyLaborDemand. This file adds no rule of its own — it only
// formats. If a rule ever changes, it changes there and this keeps working.

/** "2026-09-01 14:00" -> "2026-09-01" */
const dateOf = (hourLabel) => String(hourLabel).slice(0, 10);

/** Groups hour labels by their date so one bad day is one line, not thirteen. */
function groupHoursByDate(hourLabels = []) {
  const byDate = new Map();
  for (const label of hourLabels) {
    const date = dateOf(label);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(String(label).slice(11));
  }
  return byDate;
}

/**
 * Store-level findings: coverage and the hour-by-hour staffing comparison.
 * Under/overstaffing is a warning, not an error — the backend itself grades it
 * that way (status WARNING, never FAILED), because a demand-driven hour being
 * one person light is a judgement call, not a rule breach.
 */
export function toStoreIssues(validation) {
  if (!validation) return [];
  const issues = [];

  if (validation.openingCoverageOk === false) {
    issues.push({ code: 'NO_OPENER', severity: 'error', message: 'ไม่ผ่านเงื่อนไขคนเปิดร้าน (ตรวจโดยระบบหลังบ้าน)' });
  }
  if (validation.closingCoverageOk === false) {
    issues.push({ code: 'NO_CLOSER', severity: 'error', message: 'ไม่ผ่านเงื่อนไขคนปิดร้าน (ต้องมีอย่างน้อย 2 คนในชั่วโมงปิดร้าน)' });
  }

  for (const [date, hours] of groupHoursByDate(validation.understaffedHours)) {
    issues.push({ code: 'UNDERSTAFFED', day: date, severity: 'warning', message: `${date}: คนไม่พอ ${hours.length} ชั่วโมง (${hours.join(', ')})` });
  }
  for (const [date, hours] of groupHoursByDate(validation.overstaffedHours)) {
    issues.push({ code: 'OVERSTAFFED', day: date, severity: 'warning', message: `${date}: คนเกินความต้องการ ${hours.length} ชั่วโมง (${hours.join(', ')})` });
  }

  for (const entry of validation.monthlyGuidelineViolations ?? []) {
    issues.push({
      code: 'OVER_MONTHLY_GUIDELINE',
      severity: 'error',
      message: `เกินโควตาชั่วโมงแรงงานของเดือน ${entry.monthKey ?? ''} (ใช้ ${entry.hoursUsedOrCommitted ?? '?'} จาก ${entry.monthlyGuideline ?? '?'} ชม.)`.trim(),
    });
  }

  return issues;
}

/**
 * Per-employee findings. Each backend violation array carries employeeId, so
 * they regroup onto the staff rows the grid already shows.
 */
export function toStaffResults(validation, staff = []) {
  if (!validation) return [];
  const nameById = new Map(staff.map((member) => [String(member.id), member.name]));
  const byEmployee = new Map();

  const add = (employeeId, violation) => {
    const key = String(employeeId);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push(violation);
  };

  for (const v of validation.ftWorkingHoursViolations ?? []) {
    add(v.employeeId, { code: 'FT_HOURS', day: v.date, severity: 'error', message: `${v.date}: พนักงานประจำได้ ${v.plannedHours} ชม. (ต้องเป็น 8 ชม.)${v.reason ? ` — ${v.reason}` : ''}` });
  }
  for (const v of validation.ftBreakViolations ?? []) {
    add(v.employeeId, { code: 'FT_BREAK', day: v.date, severity: 'error', message: `${v.date}: เวลาพักของพนักงานประจำไม่ถูกต้อง — ${v.reason}` });
  }
  for (const v of validation.ftWeeklyHourViolations ?? []) {
    add(v.employeeId, { code: 'FT_WEEKLY', severity: 'error', message: `ทำงาน ${v.maxRolling7DayHours} ชม. ในรอบ 7 วัน เกินเพดาน 48 ชม.` });
  }
  for (const v of validation.consecutiveDayViolations ?? []) {
    add(v.employeeId, { code: 'CONSECUTIVE_DAYS', severity: 'error', message: `ทำงานติดต่อกัน ${v.consecutiveWorkingDays} วัน เกินเพดาน 6 วัน` });
  }
  for (const v of validation.ptHoursViolations ?? []) {
    add(v.employeeId, { code: 'PT_HOURS', day: v.date, severity: 'error', message: `${v.date}: พาร์ทไทม์ได้ ${v.plannedHours} ชม. (ต้องอยู่ระหว่าง 4-8 ชม.)` });
  }
  for (const v of validation.ptBreakViolations ?? []) {
    add(v.employeeId, { code: 'PT_BREAK', day: v.date, severity: 'error', message: `${v.date}: ${v.reason}` });
  }
  for (const v of validation.shiftWindowViolations ?? []) {
    add(v.employeeId, { code: 'SHIFT_WINDOW', day: v.date, severity: 'error', message: `${v.date}: กะ ${v.startTime}-${v.endTime} อยู่นอกเวลาทำการ 09:00-22:00` });
  }
  for (const v of validation.doubleBookingViolations ?? []) {
    add(v.employeeId, { code: 'DOUBLE_BOOKING', day: v.date, severity: 'error', message: `${v.date}: ถูกจัดซ้อนกัน ${v.shiftIds?.length ?? 2} กะในวันเดียว` });
  }
  for (const v of validation.employeesOverLimit ?? []) {
    add(v.employeeId ?? v.id, { code: 'OVER_LIMIT', severity: 'error', message: v.message ?? 'เกินเพดานชั่วโมงที่กำหนด' });
  }

  return [...byEmployee.entries()].map(([staffId, violations]) => ({
    staffId,
    name: nameById.get(staffId) ?? staffId,
    violations,
  }));
}

/**
 * Per-day counts of the hours the backend flagged, for the coverage table.
 * These are the real hour-by-hour comparisons against computeHourlyLaborDemand
 * — they replace any "recommended headcount" the frontend used to guess from a
 * sales band.
 */
export function hourIssueCountsByDate(validation) {
  const counts = {};
  const bump = (label, key) => {
    const date = dateOf(label);
    if (!counts[date]) counts[date] = { understaffed: 0, overstaffed: 0 };
    counts[date][key] += 1;
  };
  for (const label of validation?.understaffedHours ?? []) bump(label, 'understaffed');
  for (const label of validation?.overstaffedHours ?? []) bump(label, 'overstaffed');
  return counts;
}

/** Both halves of the compliance panel, from one backend response. */
export function toDisplayValidation(validation, staff = []) {
  return {
    status: validation?.status ?? null,
    storeIssues: toStoreIssues(validation),
    staffResults: toStaffResults(validation, staff),
    hourIssuesByDate: hourIssueCountsByDate(validation),
  };
}

/**
 * Days the backend flagged for a given employee, used to highlight grid cells.
 * Replaces the frontend's own re-derivation of the same thing.
 */
export function violationDaysForStaff(staffResults, staffId) {
  const entry = staffResults.find((r) => String(r.staffId) === String(staffId));
  return new Set((entry?.violations ?? []).filter((v) => v.day).map((v) => v.day));
}
