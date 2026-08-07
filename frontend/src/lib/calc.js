/* Date / formatting / scheduling helpers */

export const pad2 = (n) => String(n).padStart(2, "0");

export const todayMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

export const daysInMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

export const monthDates = (ym) => {
  const n = daysInMonth(ym);
  return Array.from({ length: n }, (_, i) => `${ym}-${pad2(i + 1)}`);
};

export const thaiWeekday = (dateStr) => {
  const days = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  return days[new Date(dateStr).getDay()];
};

export const fmtNum = (n, d = 0) =>
  (n || 0).toLocaleString("th-TH", { maximumFractionDigits: d, minimumFractionDigits: d });

export const excelDateToStr = (val) => {
  if (typeof val === "number") {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  const m2 = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m2) return `${m2[3]}-${pad2(+m2[2])}-${pad2(+m2[1])}`;
  return null;
};

export function calcGuidelineHours(sales, guideline) {
  if (!guideline || guideline.length === 0) return 0;
  const sorted = [...guideline].sort((a, b) => a.min - b.min);
  for (const tier of sorted) {
    if (sales >= tier.min && (tier.max === null || sales <= tier.max)) return tier.hours;
  }
  return sorted[sorted.length - 1].hours;
}

// simple linear regression forecast over entered points, projected across the whole month
export function forecastMonth(ym, salesMap) {
  const dates = monthDates(ym);
  const entries = dates
    .map((d, i) => ({ i, d, v: salesMap[d] }))
    .filter((e) => typeof e.v === "number" && !isNaN(e.v));
  let slope = 0,
    intercept = entries.length ? entries[entries.length - 1].v : 0;
  if (entries.length >= 2) {
    const n = entries.length;
    const sumX = entries.reduce((s, e) => s + e.i, 0);
    const sumY = entries.reduce((s, e) => s + e.v, 0);
    const sumXY = entries.reduce((s, e) => s + e.i * e.v, 0);
    const sumXX = entries.reduce((s, e) => s + e.i * e.i, 0);
    const denom = n * sumXX - sumX * sumX;
    slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    intercept = (sumY - slope * sumX) / n;
  }
  const projected = {};
  dates.forEach((d, i) => {
    if (typeof salesMap[d] === "number") projected[d] = salesMap[d];
    else projected[d] = Math.max(0, Math.round(slope * i + intercept));
  });
  return { projected, slope, hasData: entries.length > 0 };
}

export function generateSchedule(ym, salesMap, guideline, employees) {
  const dates = monthDates(ym);
  const { projected } = forecastMonth(ym, salesMap);
  const totalMonthSales = Object.values(projected).reduce((a, b) => a + b, 0);
  const totalGuidelineHours = calcGuidelineHours(totalMonthSales, guideline);

  const weeksIndex = (dateStr) => Math.floor((Number(dateStr.split("-")[2]) - 1) / 7);
  const empState = {};
  employees.forEach((e) => (empState[e.id] = { weekHours: {}, dayHoursToday: 0 }));

  const dailyBudget = {};
  const shifts = {};

  dates.forEach((d) => {
    const weight = totalMonthSales > 0 ? projected[d] / totalMonthSales : 1 / dates.length;
    dailyBudget[d] = Math.round(totalGuidelineHours * weight);
    let remaining = dailyBudget[d];
    const dayHoursByEmp = {};
    let guard = 0;
    const wIdx = weeksIndex(d);
    while (remaining > 0.4 && guard < employees.length * 12 && employees.length > 0) {
      guard++;
      const candidates = employees
        .map((e) => e)
        .filter((e) => {
          const st = empState[e.id];
          const wk = st.weekHours[wIdx] || 0;
          const dayH = dayHoursByEmp[e.id] || 0;
          return dayH < (e.maxDay || 8) && wk < (e.maxWeek || 48);
        })
        .sort((a, b) => (empState[a.id].weekHours[wIdx] || 0) - (empState[b.id].weekHours[wIdx] || 0));
      if (candidates.length === 0) break;
      const emp = candidates[0];
      const st = empState[emp.id];
      const wk = st.weekHours[wIdx] || 0;
      const dayH = dayHoursByEmp[emp.id] || 0;
      const shiftLen = Math.max(
        0,
        Math.min(4, remaining, (emp.maxDay || 8) - dayH, (emp.maxWeek || 48) - wk)
      );
      if (shiftLen <= 0.2) continue;
      dayHoursByEmp[emp.id] = dayH + shiftLen;
      st.weekHours[wIdx] = wk + shiftLen;
      remaining -= shiftLen;
    }
    shifts[d] = Object.entries(dayHoursByEmp).map(([empId, hours]) => ({
      empId,
      hours: Math.round(hours * 2) / 2,
    }));
  });

  return {
    status: "draft",
    generatedAt: new Date().toISOString(),
    totalGuidelineHours,
    totalMonthSales,
    dailyBudget,
    shifts,
    comment: "",
  };
}

export function branchKpi(branchId, branches, salesByBranch, targetByBranch, employeesByBranch, scheduleByBranch, actualByBranch, guideline) {
  const b = branches.find((x) => x.id === branchId);
  const sales = salesByBranch[branchId] || {};
  const employees = employeesByBranch[branchId] || [];
  const actual = actualByBranch[branchId] || {};
  const salesActual = Object.values(sales).reduce((a, b2) => a + (b2 || 0), 0);
  const targetVal = targetByBranch[branchId] || 0;
  const laborHours = Object.values(actual).reduce(
    (s, dm) => s + Object.values(dm || {}).reduce((a, b2) => a + b2, 0),
    0
  );
  const laborCost = Object.entries(actual).reduce((sum, [date, dm]) => {
    return (
      sum +
      Object.entries(dm || {}).reduce((s2, [empId, hrs]) => {
        const emp = employees.find((e) => e.id === empId);
        return s2 + (emp ? emp.rate * hrs : 0);
      }, 0)
    );
  }, 0);
  const col = salesActual > 0 ? (laborCost / salesActual) * 100 : 0;
  const productivity = laborHours > 0 ? salesActual / laborHours : 0;
  const guidelineHours = calcGuidelineHours(salesActual, guideline);
  const scheduleStatus = scheduleByBranch[branchId] ? scheduleByBranch[branchId].status : "none";
  return { name: b?.name || branchId, salesActual, target: targetVal, laborHours, laborCost, col, productivity, guidelineHours, scheduleStatus };
}
