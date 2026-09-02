-- STRUCTURAL, DESTRUCTIVE MIGRATION — explicitly approved by the project
-- owner, who explicitly accepted data loss. Run manually in the Supabase
-- SQL editor (no migration runner in this repo). Take a backup first if you
-- want one — this is irreversible as written.
--
-- WHAT THIS CHANGES
-- store.id goes from `UUID DEFAULT gen_random_uuid()` to `VARCHAR(50)` with
-- no default. The Excel-supplied Store ID (e.g. "1001") becomes the actual
-- database primary key, replacing the previous design where store.id was a
-- random UUID and store.storeCode separately held the Excel ID.
-- store.storeCode is kept as a non-canonical compatibility column (not
-- dropped, since other code/reports may still read it) — store.id is now
-- the single canonical identity.
--
-- WHAT THIS DOES NOT CHANGE
-- employee.id and users.id stay UUID: no importer in this codebase reads a
-- source "Staff ID"/"User ID" from any Excel file (confirmed by inspection —
-- the generic employee importer matches by store+name, not a source ID), so
-- there's no source-controlled identity to adopt for these tables. area_coach.id
-- also stays UUID — Store Master resolves Area Coaches by name, not an ID.
-- No permissions/roles/forecast/labor/roster business logic is touched.
--
-- WHY DATA MUST BE CLEARED
-- Existing store.id UUID values have no derivable "correct" VARCHAR Store ID
-- — per explicit instruction, this migration does NOT attempt to backfill
-- IDs from storeCode/report_store_id (even though those columns happen to
-- already hold the real source ID for most existing rows and a lossless
-- migration was technically possible via them). This is a clean reset.
--
-- Data cleared: store (569 rows), sales_report (17,546), sales_by_hour
-- (7,102), and (transitively, via CASCADE) roster, sales_record,
-- sales_forecast, kpi_snapshot, labor_guideline, shift, actual_hours,
-- sales_validation, labor_recommendation (0 rows each as of this writing).
-- users/employee rows are NOT deleted — only their store_id is cleared to
-- NULL — since accounts/employee records aren't "imported transactional
-- data" the way sales/roster rows are; there's no reason to destroy them
-- just because their store reference has to be cleared. role,
-- sales_source_type, forecast_model_run, and area_coach (10 rows) are never
-- touched.
--
-- RE-VERIFIED LIVE (read-only) immediately before finalizing this version:
-- every table above exists, the 9 FK columns retargeted below are the
-- complete and only set of live FKs pointing at store.id, and the CASCADE
-- dependency graph (shift/actual_hours/sales_validation/labor_recommendation)
-- was walked table-by-table against the live DB, not assumed. Two things
-- could not be verified this way, since PostgREST does not expose
-- pg_constraint/pg_indexes over the REST API: (a) the actual live names of
-- the FK constraints being dropped — irrelevant here, since step 3 finds and
-- drops them dynamically instead of hard-coding names; (b) whether any
-- secondary index/unique constraint exists on a retyped column beyond the
-- store PK itself — low risk in practice, since every affected table is
-- truncated before its column type changes, so there is no data for such an
-- index to conflict with at ALTER time.
--
-- Safe to run more than once: step 0 aborts the whole transaction cleanly if
-- store.id is already VARCHAR, instead of re-truncating data.

BEGIN;

-- 0. Idempotency guard — makes this script safe to run more than once by
--    accident. If store.id is already VARCHAR, this migration has already
--    been applied; abort the whole transaction (nothing below executes,
--    nothing gets re-truncated) instead of wiping out data imported since
--    the first run.
DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'store' AND column_name = 'id'
  ) = 'character varying' THEN
    RAISE EXCEPTION 'Migration already applied: store.id is already VARCHAR. Aborting to avoid re-truncating data.';
  END IF;
END $$;

-- 1. Clear every table that transactionally depends on `store`. CASCADE
--    lets Postgres resolve the full dependency graph itself (this also
--    clears shift, actual_hours, sales_validation, labor_recommendation)
--    rather than this script hard-coding an order that could go stale.
TRUNCATE TABLE
  sales_report,
  sales_by_hour,
  sales_record,
  sales_forecast,
  kpi_snapshot,
  labor_guideline,
  roster
  CASCADE;

-- 2. users/employee are accounts, not imported transactional data — detach
--    them from their (about-to-be-invalid) store reference instead of
--    deleting the rows outright.
UPDATE users SET store_id = NULL WHERE store_id IS NOT NULL;
UPDATE employee SET store_id = NULL WHERE store_id IS NOT NULL;

-- 3. Drop every FK constraint that currently references store(id), whatever
--    its actual live name is — avoids hard-coding possibly-wrong names.
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

-- 4. Now safe to clear store itself and change its primary key type.
TRUNCATE TABLE store;

ALTER TABLE store
  ALTER COLUMN id DROP DEFAULT;
ALTER TABLE store
  ALTER COLUMN id TYPE VARCHAR(50) USING id::text;

COMMENT ON COLUMN store."storeCode" IS 'Non-canonical compatibility field — store.id is now the canonical Store ID.';

-- 5. Retype every FK column that referenced store.id to match. Nullability
--    (NOT NULL vs nullable) is preserved automatically by ALTER COLUMN TYPE
--    — not touched here.
ALTER TABLE users            ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE employee         ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE roster           ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE sales_record     ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE sales_forecast   ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE kpi_snapshot     ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE labor_guideline  ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE sales_report     ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;
ALTER TABLE sales_by_hour    ALTER COLUMN store_id TYPE VARCHAR(50) USING store_id::text;

-- 6. Recreate the foreign keys against the new VARCHAR(50) primary key,
--    preserving the same ON UPDATE/ON DELETE behavior documented in
--    docs/master_roster_schema.sql for each of these relationships.
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

-- After running: reload the PostgREST schema cache (Settings -> API ->
-- "Reload schema", or `NOTIFY pgrst, 'reload schema';`) or you'll see
-- PGRST205-style "table/column not found" errors on the next request.
