# Testing Plan

## 1. Unit Tests (Jest)

| Module | Cases |
|--------|-------|
| `forecastService` | SMA averages correctly over window; linear regression recovers a known slope/intercept on synthetic data; handles empty/1-row history without throwing; each run creates exactly one `ForecastModelRun` and the correct number of `SalesForecast` rows. |
| `rosterService` | Never exceeds the derived `allowedHours`; never double-books an employee on the same day; caps an individual employee at 48h/week; distributes fairly (fewest-hours-first) across active employees; handles a store with zero forecasted sales / no `LaborGuideline` gracefully (`allowedHours` falls back to unrestricted or 0, per intended behavior — confirm which). |
| `laborService` | `recordActualHours` correctly flags `isOverPlanned` when actual > planned; upsert semantics (calling twice for the same shift updates rather than duplicates, since `ActualHours.shiftId` is unique). |
| `dashboardService` | Productivity calculation matches `salesActual / actualHours`; handles stores with zero actual hours without dividing by zero; `getCompanyDashboard` respects `getAllowedStoreIds` scoping once real per-user roles exist. |
| `importService` | Valid rows create records correctly; unknown store names are collected as row-level errors without aborting the whole import; sales imports are tagged with the `EXCEL_IMPORT` source type. |

## 2. Integration Tests (Supertest + test DB)

- Every route currently succeeds without a token (login deferred) — verify this is intentional in your test environment and add a `SKIP_AUTH=false` style guard before any real deployment.
- `POST /roster/generate` — with a fixture store/employees/guideline, assert `totalScheduledHours <= allowedHours`.
- `PUT /labor` — recording hours above the shift's planned hours returns a warning message and `isOverPlanned: true`.
- Excel import endpoints — malformed rows return partial success with an `errors` array; well-formed files fully import; store-name matching is case/whitespace sensitive (document this or add normalization if it causes real-world friction).
- `GET /dashboard` and `GET /dashboard/store/:id` — verify productivity, labor %, and remaining hours match hand-calculated expected values for a small fixture dataset.

## 3. End-to-End (manual or Playwright/Cypress)

1. Generate a roster for a store with no `LaborGuideline` — confirm the UI shows "no labor guideline set" rather than crashing on a null `allowedHours`.
2. Generate a roster for a store with a guideline and sales forecast — verify total scheduled hours never exceeds the computed budget.
3. Record actual hours for a shift from the Roster page — verify the Labor Hours page reflects the update.
4. Record actual hours exceeding planned hours — verify the warning message appears.
5. Import a sample sales `.xlsx` (columns: `storeName, date, amount`) — verify the Company Dashboard totals update.
6. Import a sample employee `.xlsx` with an unknown `storeName` — verify the row shows up in the `errors` array without blocking the other rows.

## 4. Before real login exists

Since every request currently authenticates as a fixed Admin-equivalent
identity (see README §6), **do not run these tests against a shared/public
database** — anyone with network access to the API can read/write everything.
Use a local or ephemeral test database for all of the above until
authentication is implemented.

## 5. Non-functional

- **Performance**: dashboard endpoints should respond in <500ms for a store with a full year of daily sales/shift rows (add indexes/pagination if not — see `docs/DatabaseDesign.md` §Indexing).
- **Data integrity**: attempt to delete a store with existing rosters/employees and confirm the `onDelete: Cascade` / `onDelete: Restrict` behavior in `schema.prisma` matches your expectations before relying on it in production.
- **UUID generation**: confirm `pgcrypto` is enabled in every environment (local, CI, staging, production) — migrations will fail without it.
