# Future Improvements

## Immediate priorities (things this version deliberately deferred)

- **Real login/authentication** — the highest-priority item. Add a
  `user_credential` table, restore JWT issuance, and replace the stubbed
  `authenticate` middleware. See README §6 for the exact steps; the
  RBAC/storeScope logic is already written and just needs a real identity
  source to check against.
- **Activity Log** — add an `activity_log` table back to `schema.prisma`
  (the ERD you supplied doesn't include one) so `logActivity()` persists
  instead of just console-logging.
- **Shift Templates & Employee Availability** — add these tables back if you
  want per-store configurable shift windows and availability-aware
  scheduling instead of the current fixed-window, no-availability-filter
  roster generator.
- **Employment type (full-time/part-time) priority** — add an
  `employment_type` column to `Employee` to restore that scheduling priority.

## Further out

- **Smarter forecasting**: seasonality-aware models (day-of-week, holiday calendars, promotions); populate `ForecastModelRun.accuracyScore` by comparing forecasts to actuals after the fact.
- **Labor recommendation automation**: `LaborRecommendation` is modeled in the schema but nothing populates it yet — have `rosterService` (or a separate job) write one per forecast/guideline pair.
- **KPI snapshot job**: a scheduled job that writes daily `KpiSnapshot` rows from the same calculation `dashboardService` does live, enabling fast historical trend queries without recomputing from raw sales/shift data every time.
- **Sales validation workflow**: `SalesValidation` is modeled (comparing an imported record against a manual one) but no service currently creates or resolves these rows — build the comparison + review UI.
- **Optimization-based rostering**: replace the greedy fair-distribution allocator with a constraint solver that jointly optimizes labor cost, fairness, and the `minStaffPerShift` guideline (not yet enforced).
- **Store code / external ID**: add a unique `code` column to `Store` for more robust Excel-import matching than exact name matching.
- **Notifications**: alerts when a store crosses 90%/100% of its labor budget, or when a roster is published.
- **Mobile app / PWA**: a lightweight mobile view for clocking actual hours per shift and checking today's roster.
- **Payroll integration** (explicitly out of scope for this decision-support system): export approved rosters/actual hours to a payroll system via a dedicated integration.
- **Automated testing pipeline**: CI running the Jest/Supertest suite in `docs/TESTING.md` against an ephemeral Postgres instance on every PR.
