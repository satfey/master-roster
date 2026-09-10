-- Seeds labor_hour_guideline_tier with the company's actual Sales/Day ->
-- Labor Hours guideline, from the "Master-Revise" sheet of the business
-- reference Excel file (NOT the earlier "COLGlobal" sheet, and NOT the
-- earlier 3-example placeholder values shown before this file existed —
-- those were never inserted; this table has been confirmed empty).
--
-- WHAT THIS ADDS
-- 1. labor_hour_guideline_tier gets three new nullable columns:
--      level                  SMALLINT      -- Master-Revise's "Level" column (1-12 below)
--      standard_working_hours NUMERIC(4,2)  -- Master-Revise's "Standard Working Day" column
--      min_staff_count        SMALLINT      -- Master-Revise's "Staff requirement" column
--    Only `level` is populated by this migration (given below); the other
--    two are added now so a later seed can fill them in without a third
--    migration, but are left NULL here since those specific figures were
--    not provided yet — nothing is invented or estimated for them.
-- 2. 12 global tier rows (store_id NULL — applies to every store without
--    its own override), exactly the Sales/Day ranges and labor-hour values
--    given, in THB/day:
--      0–6,000      Level 1  -> 12h   6,001–8,000    Level 2  -> 12h
--      8,001–10,000 Level 3  -> 12h   10,001–12,000  Level 4  -> 12h
--      12,001–13,000 Level 5 -> 12h   13,001–15,000  Level 6  -> 12h
--      15,001–16,000 Level 7 -> 12h   16,001–17,000  Level 8  -> 12h
--      17,001–19,000 Level 9 -> 12h   19,001–21,000  Level 10 -> 12h
--      21,001–23,000 Level 11 -> 12h  23,001–25,000  Level 12 -> 12h
--    A store's daily sales/budget above 25,000 (outside every range here)
--    still falls back to target_productivity-derived sizing automatically
--    — matchTier() in laborBudgetService.js already handles "no tier
--    matched" this way, so no application code change was needed for that.
--
-- WHAT THIS DOES NOT TOUCH
-- Any other table; no existing rows anywhere are modified (the tier table
-- was empty). Rolling monthly capacity / actual-hours logic is unchanged.
--
-- Safe to run more than once: the column-add step is guarded, and the
-- row-insert step is guarded to skip if any global tier already exists
-- (so a second run doesn't duplicate the 12 rows).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'labor_hour_guideline_tier' AND column_name = 'level'
  ) THEN
    ALTER TABLE labor_hour_guideline_tier ADD COLUMN level SMALLINT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'labor_hour_guideline_tier' AND column_name = 'standard_working_hours'
  ) THEN
    ALTER TABLE labor_hour_guideline_tier ADD COLUMN standard_working_hours NUMERIC(4, 2);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'labor_hour_guideline_tier' AND column_name = 'min_staff_count'
  ) THEN
    ALTER TABLE labor_hour_guideline_tier ADD COLUMN min_staff_count SMALLINT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM labor_hour_guideline_tier WHERE store_id IS NULL) THEN
    INSERT INTO labor_hour_guideline_tier (store_id, sales_min, sales_max, allowed_labor_hours, level) VALUES
      (NULL, 0,      6000,  12, 1),
      (NULL, 6001,   8000,  12, 2),
      (NULL, 8001,   10000, 12, 3),
      (NULL, 10001,  12000, 12, 4),
      (NULL, 12001,  13000, 12, 5),
      (NULL, 13001,  15000, 12, 6),
      (NULL, 15001,  16000, 12, 7),
      (NULL, 16001,  17000, 12, 8),
      (NULL, 17001,  19000, 12, 9),
      (NULL, 19001,  21000, 12, 10),
      (NULL, 21001,  23000, 12, 11),
      (NULL, 23001,  25000, 12, 12);
  END IF;
END $$;

COMMIT;

-- After running: reload the PostgREST schema cache (Settings -> API ->
-- "Reload schema", or `NOTIFY pgrst, 'reload schema';`).
