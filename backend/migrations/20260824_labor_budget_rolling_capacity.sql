-- PHASE 2: budget-driven, continuously-adaptive roster generation.
-- Purely additive — no existing column is retyped, no existing table is
-- cleared, no existing FK is touched. Safe to run once; each piece below
-- is individually idempotency-guarded so a partial re-run doesn't error.
--
-- WHAT THIS ADDS
-- 1. labor_guideline.monthly_labor_hours — the store-level monthly labor-hour
--    cap (e.g. 1,000 hours/month). Nullable: a store with no value set keeps
--    behaving exactly as it does today (no monthly-hours enforcement),
--    exactly like target_productivity being unset today.
-- 2. labor_hour_guideline_tier — the Sales/Budget -> Labor Hours business
--    guideline (currently missing from the schema entirely — confirmed via
--    a full live table listing). store_id NULL = a global default tier,
--    non-null = a store-specific override. Starts EMPTY: no tier values are
--    invented here. Until rows are added, roster generation keeps sizing
--    daily labor hours from target_productivity exactly as it does today
--    (see laborBudgetService.js). Authorized users manage rows through the
--    new tier CRUD API — no code change needed to adjust the guideline.
-- 3. store_actual_hours — a store+date-level actual-labor-hours entry,
--    independent of any single shift (e.g. "Friday actual = 68 hours" after
--    an event). This is deliberately a separate table from the existing
--    per-shift `actual_hours` (shift_id, 1:1 with a Shift) rather than an
--    extension of it: the two represent different granularities (a precise
--    per-shift clock-in/out record vs. a coarser store-day total), and
--    mixing them into one table would require nullable, mutually-exclusive
--    columns for no real benefit. Both tables now coexist; nothing about
--    the existing per-shift actual_hours flow (PUT /labor) changes.
--
-- WHAT THIS DOES NOT TOUCH
-- store.id / employee.id identity, roster/shift structure, forecast tables,
-- Sales Report/Sales-by-Hour/Store Master/Employee Master data.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'labor_guideline' AND column_name = 'monthly_labor_hours'
  ) THEN
    ALTER TABLE labor_guideline ADD COLUMN monthly_labor_hours NUMERIC(10, 2);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS labor_hour_guideline_tier (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id            VARCHAR(50) REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE, -- NULL = applies to every store without its own override
    sales_min           NUMERIC(14, 2) NOT NULL,
    sales_max           NUMERIC(14, 2) NOT NULL,
    allowed_labor_hours NUMERIC(8, 2) NOT NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT now(),
    updated_at          TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (sales_min < sales_max)
);
CREATE INDEX IF NOT EXISTS idx_labor_hour_guideline_tier_store ON labor_hour_guideline_tier(store_id);

CREATE TABLE IF NOT EXISTS store_actual_hours (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id      VARCHAR(50) NOT NULL REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE,
    actual_date   DATE NOT NULL,
    actual_hours  NUMERIC(8, 2) NOT NULL,
    recorded_by   UUID REFERENCES users(id),
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (store_id, actual_date)
);

COMMIT;

-- After running: reload the PostgREST schema cache (Settings -> API ->
-- "Reload schema", or `NOTIFY pgrst, 'reload schema';`).
