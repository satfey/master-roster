const { operatingHourList } = require('./storeOperatingHours');

/**
 * Converts an hourly sales forecast into a MINIMUM required headcount and a
 * productivity-floor MAXIMUM justified headcount, per hour.
 *
 * target_productivity is a MINIMUM ACCEPTABLE productivity FLOOR, not a
 * target to reach by adding staff — the roster generator must never add an
 * employee "to bring productivity down toward" the floor, and never chase
 * it via rounding. Concretely:
 *
 *   requiredHeadcount(hour)      = max(min_staff_per_shift, 1)
 *     — the operational/coverage minimum. Sales-INDEPENDENT: this never
 *     scales up just because an hour has high sales. This is what
 *     "understaffed" is measured against.
 *
 *   maxJustifiedHeadcount(hour)  = max(floor(forecastedSales / target_productivity), requiredHeadcount)
 *     — the most people that hour's sales can support without productivity
 *     dropping below the floor. Math.floor (never ceil): rounding up would
 *     let sales/headcount fall below target_productivity, which the floor
 *     forbids. This is a CEILING the roster generator may staff UP TO when
 *     justified (see rosterGenerationService's productivity-justified fill
 *     phase), never a number it is trying to reach. This is what
 *     "overstaffed" is measured against.
 *
 * If no labor_guideline exists yet for the store, requiredLaborHours and
 * maxJustifiedHeadcount collapse to the same operational minimum — the
 * roster can still guarantee coverage, it just can't be demand-sized. A
 * warning is surfaced either way so this is never silent.
 */
const ABSURD_HEADCOUNT_THRESHOLD = 30; // sanity cap on maxJustifiedHeadcount — flags a likely misconfigured target_productivity rather than trusting the math blindly

function computeHourlyLaborDemand({ hourlyForecast, guideline }) {
  const targetProductivity = guideline?.target_productivity ? Number(guideline.target_productivity) : null;
  const minStaffPerShift = guideline?.min_staff_per_shift ? Number(guideline.min_staff_per_shift) : 0;
  const requiredHeadcount = Math.max(minStaffPerShift, 1);

  const forecastByHour = new Map(hourlyForecast.map((h) => [h.hour, Number(h.forecastedSales)]));

  return operatingHourList().map((hour) => {
    const forecastedSales = forecastByHour.get(hour) ?? 0;
    const requiredLaborHours = targetProductivity ? forecastedSales / targetProductivity : null;
    const productivityCappedHeadcount = requiredLaborHours !== null ? Math.floor(requiredLaborHours) : null;
    const maxJustifiedHeadcount = Math.max(productivityCappedHeadcount ?? 0, requiredHeadcount);

    return {
      hour,
      forecastedSales,
      requiredLaborHours: requiredLaborHours !== null ? Math.round(requiredLaborHours * 100) / 100 : null,
      requiredHeadcount,
      maxJustifiedHeadcount,
    };
  });
}

/** Runs computeHourlyLaborDemand over every day of an hourly forecast (forecastService.generateHourlyForecast's `days` shape) and collects sanity warnings. */
function computeLaborDemand({ days, guideline }) {
  const warnings = [];
  if (!guideline) {
    warnings.push('No labor guideline configured for this store — staffing is floored to min_staff_per_shift (or 1), not sized from sales forecast.');
  }

  const result = days.map((day) => {
    const hours = computeHourlyLaborDemand({ hourlyForecast: day.hours, guideline });
    for (const h of hours) {
      if (h.maxJustifiedHeadcount > ABSURD_HEADCOUNT_THRESHOLD) {
        warnings.push(`Unusually high productivity-justified headcount (${h.maxJustifiedHeadcount}) at ${day.date} ${String(h.hour).padStart(2, '0')}:00 — check target_productivity.`);
      }
    }
    const totalLaborHours = Math.round(hours.reduce((s, h) => s + (h.requiredLaborHours || 0), 0) * 100) / 100;
    const peakHeadcount = Math.max(...hours.map((h) => h.maxJustifiedHeadcount));
    return { date: day.date, hours, totalLaborHours, peakHeadcount };
  });

  return { days: result, warnings };
}

module.exports = { computeHourlyLaborDemand, computeLaborDemand, ABSURD_HEADCOUNT_THRESHOLD };
