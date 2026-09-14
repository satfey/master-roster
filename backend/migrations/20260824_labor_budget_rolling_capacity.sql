

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

