-- Replaces the existing `employee` table structure with the new Employee
-- Master structure — the same table, not a second one. Explicitly approved,
-- including a follow-up confirmation to also make employee.id itself the
-- canonical Employee ID from Excel (mirroring the store.id migration),
-- rather than keeping a separate internal UUID + employee_id pair.
--
-- WHAT THIS CHANGES
-- employee.id goes from `UUID DEFAULT gen_random_uuid()` to `VARCHAR(50)`
-- with no default — the Excel Employee ID (e.g. "000123") becomes the
-- actual primary key directly, the same pattern already applied to
-- store.id. There is no separate employee_id column.
-- shift.employee_id (the only FK into employee.id) is retyped to match and
-- its FK is recreated.
-- Drops: full_name, hourly_rate (never used in any labor/roster calculation
-- — confirmed by inspecting rosterService.js/laborService.js; full_name is
-- replaced by first_name/last_name, not duplicated).
-- Adds: title, first_name, last_name, first_name_local, last_name_local,
-- email, position_time_type, store_name, default_weekly_hours,
-- pay_rate_type, sl/hr_comp_plan, sl/hr_comp_amount, sl/hr_comp_currency,
-- sl/hr_comp_frequency, created_at, updated_at.
-- Widens: position VARCHAR(100) -> VARCHAR(150).
-- Unchanged: store_id (FK to store.id — already VARCHAR(50), inherited from
-- the store.id migration already applied), is_active.
--
-- WHY DATA IS CLEARED (not migrated)
-- employee has 0 live rows, and the old row shape has no source Employee ID
-- to key off of, so there's nothing to preserve.
--
-- WHAT THIS DOES NOT TOUCH
-- store.id / the Store Master, Sales Report, Sales-by-Hour architecture.
-- users, roster, sales_record, sales_forecast, kpi_snapshot,
-- labor_guideline, sales_report, sales_by_hour — untouched.
-- DELETE FROM employee (not TRUNCATE) is used specifically so this never
-- needs CASCADE — shift has a NOT NULL FK to employee.id, and since shift
-- currently has 0 rows, a plain DELETE succeeds without ever touching
-- shift/actual_hours/roster.
--
-- Safe to run more than once: aborts cleanly (whole transaction rolled
-- back) if employee.id is already VARCHAR, instead of re-clearing data.

BEGIN;

-- 0. Idempotency guard.
DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee' AND column_name = 'id'
  ) = 'character varying' THEN
    RAISE EXCEPTION 'Migration already applied: employee.id is already VARCHAR. Aborting to avoid re-clearing data.';
  END IF;
END $$;

-- 1. Clear existing employee data — a plain DELETE (not TRUNCATE), so this
--    never implicitly cascades into shift/actual_hours/roster; see note above.
DELETE FROM employee;

-- 2. Drop every FK constraint that currently references employee(id),
--    whatever its actual live name is (this is shift.employee_id).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE contype = 'f' AND confrelid = 'employee'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- 3. Drop obsolete columns.
ALTER TABLE employee DROP COLUMN full_name;
ALTER TABLE employee DROP COLUMN hourly_rate;

-- 4. Change the primary key itself: the Excel Employee ID becomes
--    employee.id directly — never a generated UUID, and never a second
--    "employee_id" column competing with it.
ALTER TABLE employee ALTER COLUMN id DROP DEFAULT;
ALTER TABLE employee ALTER COLUMN id TYPE VARCHAR(50) USING id::text;

-- 5. Add the rest of the new Employee Master columns.
ALTER TABLE employee
  ADD COLUMN title                 VARCHAR(100),
  ADD COLUMN first_name            VARCHAR(150),
  ADD COLUMN last_name             VARCHAR(150),
  ADD COLUMN first_name_local      VARCHAR(150),
  ADD COLUMN last_name_local       VARCHAR(150),
  ADD COLUMN email                 VARCHAR(255),
  ADD COLUMN position_time_type    VARCHAR(50),
  ADD COLUMN store_name            VARCHAR(150),
  ADD COLUMN default_weekly_hours  NUMERIC(8, 2),
  ADD COLUMN pay_rate_type         VARCHAR(50),
  ADD COLUMN sl_comp_plan          VARCHAR(100),
  ADD COLUMN sl_comp_amount        NUMERIC(14, 2),
  ADD COLUMN sl_comp_currency      VARCHAR(10),
  ADD COLUMN sl_comp_frequency     VARCHAR(50),
  ADD COLUMN hr_comp_plan          VARCHAR(100),
  ADD COLUMN hr_comp_amount        NUMERIC(14, 2),
  ADD COLUMN hr_comp_currency      VARCHAR(10),
  ADD COLUMN hr_comp_frequency     VARCHAR(50),
  ADD COLUMN created_at            TIMESTAMP NOT NULL DEFAULT now(),
  ADD COLUMN updated_at            TIMESTAMP NOT NULL DEFAULT now();

-- 6. Widen position per the new spec (VARCHAR(100) -> VARCHAR(150)).
ALTER TABLE employee ALTER COLUMN position TYPE VARCHAR(150);

-- 7. Retype shift.employee_id to match and recreate its FK, preserving the
--    same ON UPDATE/ON DELETE behavior documented in
--    docs/master_roster_schema.sql (RESTRICT, not CASCADE — deleting an
--    employee with existing shifts should fail loudly, not silently wipe
--    roster history).
ALTER TABLE shift ALTER COLUMN employee_id TYPE VARCHAR(50) USING employee_id::text;
ALTER TABLE shift ADD CONSTRAINT fk_shift_employee FOREIGN KEY (employee_id) REFERENCES employee(id) ON UPDATE CASCADE ON DELETE RESTRICT;

COMMIT;

-- After running: reload the PostgREST schema cache (Settings -> API ->
-- "Reload schema", or `NOTIFY pgrst, 'reload schema';`).
