

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


