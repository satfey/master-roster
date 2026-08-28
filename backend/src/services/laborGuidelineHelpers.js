/**
 * Shared labor-guideline math — previously copy-pasted independently in
 * rosterService, laborService, and dashboardService. Kept as one function so
 * the three stay in sync.
 */
function computeAllowedHours(guideline, forecastTotal) {
  const targetProductivity = guideline?.target_productivity ? Number(guideline.target_productivity) : null;
  if (!targetProductivity || !forecastTotal) return null;
  return Math.round(forecastTotal / targetProductivity);
}

module.exports = { computeAllowedHours };
