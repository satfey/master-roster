-- Extends labor_hour_guideline_tier with a weekday/weekend split, and adds
-- 17 new tiers for the 200,000-1,000,000+ THB/day range, from the business
-- reference (Master-Revise-derived guideline given directly in chat). This
-- range's hours genuinely differ between weekday and weekend, which the
-- existing single `allowed_labor_hours` column cannot represent.
--
-- WHAT THIS ADDS
-- 1. labor_hour_guideline_tier gets two new nullable columns:
--      weekday_labor_hours  NUMERIC(8,2)
--      weekend_labor_hours  NUMERIC(8,2)
--    `allowed_labor_hours` is loosened to nullable (was NOT NULL) — it
--    remains a legacy/flat fallback for a tier that doesn't distinguish
--    weekday/weekend (matchTier() in laborBudgetService.js now checks
--    weekday_labor_hours/weekend_labor_hours FIRST, falling back to
--    allowed_labor_hours only if the day-specific column is null).
-- 2. Backfills the 12 existing Level 1-12 rows (0-25,000 THB, seeded by
--    20260825_labor_hour_tier_seed.sql): weekday_labor_hours = 12,
--    weekend_labor_hours = 12 — the SAME 12h figure already given for
--    that range (no weekday/weekend split was given there, so both
--    columns just carry the one existing value forward; nothing new is
--    invented for these rows).
-- 3. Inserts 17 new GLOBAL tier rows (store_id NULL) for 200,000 THB and
--    up, with the exact weekday/weekend hour values given:
--      200,000-249,999   wd 25 / we 28      500,000-549,999   wd 34 / we 41
--      250,000-299,999   wd 28 / we 30      550,000-599,999   wd 35 / we 43
--      300,000-349,999   wd 30 / we 32      600,000-649,999   wd 35 / we 47
--      350,000-399,999   wd 30 / we 36      650,000-699,999   wd 35 / we 47
--      400,000-449,999   wd 30 / we 36      700,000-749,999   wd 36 / we 47
--      450,000-499,999   wd 30 / we 40      750,000-799,999   wd 36 / we 49
--                                            800,000-849,999   wd 38 / we 50
--                                            850,000-899,999   wd 41 / we 51
--                                            900,000-949,999   wd 41 / we 52
--                                            950,000-999,999   wd 41 / we 52
--                                            1,000,000+         wd 41 / we 52
--    (1,000,000+ is modeled as sales_max = 99,999,999 — an effectively
--    unbounded top tier, since no upper limit was given.)
--
-- KNOWN GAP — NOT FILLED, NOT INVENTED
-- No guideline value exists for 25,001-199,999 THB/day. A store whose
-- sales/budget falls in that range will not match ANY tier and falls back
-- to target_productivity-derived sizing (already-existing, documented
-- behavior for "no tier matched") until real values are provided.
--
-- WEEKDAY/WEEKEND DEFINITION — assumption, flagged for confirmation
-- Saturday and Sunday are treated as "weekend"; Monday-Friday as
-- "weekday" (ISO day-of-week 6 and 0). This was not specified in the
-- given guideline text; correct via a follow-up migration if the
-- business defines it differently (e.g. Friday-Sunday).
--
-- WHAT THIS DOES NOT TOUCH
-- store_id-scoped tier overrides, any other table, existing roster/shift
-- data, the Phase 1/2 rolling-capacity or actual-hours logic.
--
-- Safe to run more than once: every step is guarded.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'labor_hour_guideline_tier' AND column_name = 'weekday_labor_hours'
  ) THEN
    ALTER TABLE labor_hour_guideline_tier ADD COLUMN weekday_labor_hours NUMERIC(8, 2);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'labor_hour_guideline_tier' AND column_name = 'weekend_labor_hours'
  ) THEN
    ALTER TABLE labor_hour_guideline_tier ADD COLUMN weekend_labor_hours NUMERIC(8, 2);
  END IF;
END $$;

ALTER TABLE labor_hour_guideline_tier ALTER COLUMN allowed_labor_hours DROP NOT NULL;

-- Backfill the 12 existing Level 1-12 rows, only if they haven't been
-- backfilled yet (idempotent — re-running won't re-touch rows that
-- already have a weekday_labor_hours value, whether from this step or a
-- manual edit since).
UPDATE labor_hour_guideline_tier
SET weekday_labor_hours = allowed_labor_hours, weekend_labor_hours = allowed_labor_hours
WHERE store_id IS NULL AND level BETWEEN 1 AND 12 AND weekday_labor_hours IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM labor_hour_guideline_tier WHERE store_id IS NULL AND sales_min = 200000) THEN
    INSERT INTO labor_hour_guideline_tier (store_id, sales_min, sales_max, weekday_labor_hours, weekend_labor_hours) VALUES
      (NULL, 200000, 249999, 25, 28),
      (NULL, 250000, 299999, 28, 30),
      (NULL, 300000, 349999, 30, 32),
      (NULL, 350000, 399999, 30, 36),
      (NULL, 400000, 449999, 30, 36),
      (NULL, 450000, 499999, 30, 40),
      (NULL, 500000, 549999, 34, 41),
      (NULL, 550000, 599999, 35, 43),
      (NULL, 600000, 649999, 35, 47),
      (NULL, 650000, 699999, 35, 47),
      (NULL, 700000, 749999, 36, 47),
      (NULL, 750000, 799999, 36, 49),
      (NULL, 800000, 849999, 38, 50),
      (NULL, 850000, 899999, 41, 51),
      (NULL, 900000, 949999, 41, 52),
      (NULL, 950000, 999999, 41, 52),
      (NULL, 1000000, 99999999, 41, 52);
  END IF;
END $$;

COMMIT;

-- After running: reload the PostgREST schema cache (Settings -> API ->
-- "Reload schema", or `NOTIFY pgrst, 'reload schema';`).
