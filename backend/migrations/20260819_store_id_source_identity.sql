

BEGIN;

DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'store' AND column_name = 'id'
  ) = 'character varying' THEN
    RAISE EXCEPTION 'Migration already applied: store.id is already VARCHAR. Aborting to avoid re-truncating data.';
  END IF;
END $$;


TRUNCATE TABLE
  sales_report,
  sales_by_hour,
  sales_record,
  sales_forecast,
  kpi_snapshot,
  labor_guideline,
  roster
  CASCADE;


UPDATE users SET store_id = NULL WHERE store_id IS NOT NULL;
UPDATE employee SET store_id = NULL WHERE store_id IS NOT NULL;


DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE contype = 'f' AND confrelid = 'store'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;


TRUNCATE TABLE store;

ALTER TABLE store
  ALTER COLUMN id DROP DEFAULT;
ALTER TABLE store
  ALTER COLUMN id TYPE VARCHAR(50) USING id::text;

COMMENT ON COLUMN store."storeCode" IS 'Non-canonical compatibility field — store.id is now the canonical Store ID.';


ALTER TABLE users            ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE employee         ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE roster           ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE sales_record     ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE sales_forecast   ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE kpi_snapshot     ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE labor_guideline  ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE sales_report     ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE sales_by_hour    ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;


ALTER TABLE users           ADD CONSTRAINT fk_users_store           FOREIGN KEY (store_id) REFERENCES store(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE employee        ADD CONSTRAINT fk_employee_store        FOREIGN KEY (store_id) REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE roster          ADD CONSTRAINT fk_roster_store          FOREIGN KEY (store_id) REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE sales_record    ADD CONSTRAINT fk_sales_record_store    FOREIGN KEY (store_id) REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE sales_forecast  ADD CONSTRAINT fk_sales_forecast_store  FOREIGN KEY (store_id) REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE kpi_snapshot    ADD CONSTRAINT fk_kpi_snapshot_store    FOREIGN KEY (store_id) REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE labor_guideline ADD CONSTRAINT fk_labor_guideline_store FOREIGN KEY (store_id) REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE sales_report    ADD CONSTRAINT fk_sales_report_store    FOREIGN KEY (store_id) REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE sales_by_hour   ADD CONSTRAINT fk_sales_by_hour_store   FOREIGN KEY (store_id) REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE;

COMMIT;


