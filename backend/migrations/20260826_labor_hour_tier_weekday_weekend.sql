

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


