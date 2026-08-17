-- ============================================================================
-- Master Roster — PostgreSQL Schema
-- Generated from the ER diagram in master_roster_erd.html
-- ============================================================================
-- Notes:
--   - Uses gen_random_uuid() from the pgcrypto extension for UUID primary keys.
--   - STORE.area_coach_id and USER.store_id form a circular reference, so the
--     STORE -> USER foreign key is added via ALTER TABLE after both tables exist.
--   - Run this against an empty PostgreSQL database, or adapt into Prisma
--     migrations if you prefer schema-first development via `prisma db pull`.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- ROLE
-- ----------------------------------------------------------------------------
CREATE TABLE role (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(50) NOT NULL UNIQUE,   -- STORE_MANAGER | AREA_COACH | EXECUTIVE | ADMIN
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- ----------------------------------------------------------------------------
-- STORE  (area_coach_id FK added later, after USER exists)
-- ----------------------------------------------------------------------------
CREATE TABLE store (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(150) NOT NULL,
    "storeCode"    VARCHAR(4),    -- join key for the sales_report importer's "Store Id" column (String(reportStoreId)); quoted to preserve camelCase, matching code's .in('storeCode', ...) usage
    region         VARCHAR(100),
    area_coach_id  UUID
);

-- ----------------------------------------------------------------------------
-- "USER" (quoted — USER is a reserved word in PostgreSQL)
-- ----------------------------------------------------------------------------
CREATE TABLE "user" (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name  VARCHAR(150) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    role_id    UUID NOT NULL REFERENCES role(id)  ON UPDATE CASCADE ON DELETE RESTRICT,
    store_id   UUID REFERENCES store(id)          ON UPDATE CASCADE ON DELETE SET NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- Now that "user" exists, wire up STORE.area_coach_id -> user.id
ALTER TABLE store
    ADD CONSTRAINT fk_store_area_coach
    FOREIGN KEY (area_coach_id) REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- EMPLOYEE
-- ----------------------------------------------------------------------------
CREATE TABLE employee (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id     UUID NOT NULL REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE,
    full_name    VARCHAR(150) NOT NULL,
    position     VARCHAR(100),
    hourly_rate  NUMERIC(10, 2),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

-- ----------------------------------------------------------------------------
-- SALES_SOURCE_TYPE  (lookup: e.g. POS_IMPORT, MANUAL_ENTRY, EXCEL_IMPORT)
-- ----------------------------------------------------------------------------
CREATE TABLE sales_source_type (
    id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name  VARCHAR(50) NOT NULL UNIQUE
);

-- ----------------------------------------------------------------------------
-- SALES_RECORD
-- ----------------------------------------------------------------------------
CREATE TABLE sales_record (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL REFERENCES store(id)             ON UPDATE CASCADE ON DELETE CASCADE,
    sales_date      DATE NOT NULL,
    amount          NUMERIC(14, 2) NOT NULL,
    source_type_id  UUID NOT NULL REFERENCES sales_source_type(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    entered_by      UUID REFERENCES "user"(id)                     ON UPDATE CASCADE ON DELETE SET NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_record_store_date ON sales_record(store_id, sales_date);

-- ----------------------------------------------------------------------------
-- SALES_VALIDATION
-- Compares an imported sales record against a manually entered one for the
-- same store/date and flags variance for review.
-- ----------------------------------------------------------------------------
CREATE TABLE sales_validation (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    imported_record_id  UUID NOT NULL REFERENCES sales_record(id) ON UPDATE CASCADE ON DELETE CASCADE,
    manual_record_id    UUID REFERENCES sales_record(id)          ON UPDATE CASCADE ON DELETE CASCADE,
    status              VARCHAR(30) NOT NULL DEFAULT 'PENDING',   -- PENDING | MATCHED | FLAGGED | RESOLVED
    variance            NUMERIC(14, 2),
    reviewed_by         UUID REFERENCES "user"(id)                ON UPDATE CASCADE ON DELETE SET NULL,
    reviewed_at         TIMESTAMP,
    UNIQUE (imported_record_id)
);

-- ----------------------------------------------------------------------------
-- SALES_REPORT
-- Richer daily sales report import (Gross/Docket/Customer actual, budget,
-- variance, LY, and MTD figures) — a separate format/table from SALES_RECORD,
-- fed by a fixed 26-column Excel layout matched against store."storeCode".
-- NOTE: entered_by here references `users` (plural, unquoted) to match the
-- live Supabase table, which differs from the rest of this doc's stale
-- `"user"` (singular, quoted) references elsewhere — not corrected here since
-- that's a pre-existing, unrelated inconsistency out of scope for this table.
-- ----------------------------------------------------------------------------
CREATE TABLE sales_report (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id                      UUID NOT NULL REFERENCES store(id)             ON UPDATE CASCADE ON DELETE CASCADE,
    report_store_id               INTEGER NOT NULL,   -- raw Excel "Store ID", kept for traceability
    store_bu_id                   INTEGER,            -- denormalized (no BU table)
    store_name                    VARCHAR(150),       -- denormalized as-imported (may differ from store.name)
    week                          VARCHAR(20),        -- e.g. "2026-27" — not numeric, preserved as-is

    report_date                   DATE NOT NULL,

    gross_actual                  NUMERIC(14, 2),
    gross_budget                  NUMERIC(14, 2),
    gross_variance_percent        NUMERIC(7, 4),
    gross_actual_ly               NUMERIC(14, 2),
    gross_ly_variance_percent     NUMERIC(7, 4),
    gross_actual_mtd              NUMERIC(14, 2),
    gross_budget_mtd              NUMERIC(14, 2),
    gross_mtd_variance_percent    NUMERIC(7, 4),
    gross_actual_ly_mtd           NUMERIC(14, 2),

    docket_actual                 INTEGER,
    docket_budget                 INTEGER,
    docket_variance_percent       NUMERIC(7, 4),
    docket_actual_ly              INTEGER,
    docket_ly_variance_percent    NUMERIC(7, 4),

    customer_actual                INTEGER,
    customer_budget                INTEGER,
    customer_variance_percent      NUMERIC(7, 4),
    customer_actual_ly             INTEGER,
    customer_ly_variance_percent   NUMERIC(7, 4),

    other_sales                   NUMERIC(14, 2),
    service_charge                 NUMERIC(14, 2),

    source_type_id                UUID NOT NULL REFERENCES sales_source_type(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    entered_by                     UUID REFERENCES users(id)                     ON UPDATE CASCADE ON DELETE SET NULL,
    created_at                     TIMESTAMP NOT NULL DEFAULT now(),

    UNIQUE (store_id, report_date)
);

-- ----------------------------------------------------------------------------
-- SALES_BY_HOUR
-- Hour-of-day sales breakdown import — this report has NO date column at all
-- (confirmed with the report owner: each Gross Sale figure is aggregated
-- across an entire month, not a single day), so report_month is supplied by
-- the caller at import time, not parsed from the Excel file. Isolated from
-- SALES_REPORT and SALES_RECORD; store lookup reuses store."storeCode".
-- ----------------------------------------------------------------------------
CREATE TABLE sales_by_hour (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id         UUID NOT NULL REFERENCES store(id)             ON UPDATE CASCADE ON DELETE CASCADE,
    report_store_id  INTEGER NOT NULL,   -- raw Excel "Store Id", kept for traceability
    brand_name       VARCHAR(150),       -- preserved when present, not required
    store_name       VARCHAR(150),       -- denormalized as-imported (may differ from store.name)
    report_month     DATE NOT NULL,      -- 1st of the month this file covers — supplied by the caller
    hour             INTEGER NOT NULL,   -- hour-of-day label as given in the source file
    gross_sale       NUMERIC(14, 2) NOT NULL,

    source_type_id   UUID NOT NULL REFERENCES sales_source_type(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    entered_by       UUID REFERENCES users(id)                      ON UPDATE CASCADE ON DELETE SET NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT now(),

    UNIQUE (store_id, report_month, hour)
);

-- ----------------------------------------------------------------------------
-- FORECAST_MODEL_RUN
-- ----------------------------------------------------------------------------
CREATE TABLE forecast_model_run (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_at          TIMESTAMP NOT NULL DEFAULT now(),
    model_version   VARCHAR(50) NOT NULL,          -- e.g. "SMA-7", "LINREG-30D-v2"
    accuracy_score  NUMERIC(5, 4)                  -- e.g. 0.9231 (MAPE-derived or similar)
);

-- ----------------------------------------------------------------------------
-- SALES_FORECAST
-- ----------------------------------------------------------------------------
CREATE TABLE sales_forecast (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id          UUID NOT NULL REFERENCES store(id)              ON UPDATE CASCADE ON DELETE CASCADE,
    forecast_date     DATE NOT NULL,
    daypart           VARCHAR(30) NOT NULL DEFAULT 'FULL_DAY',        -- FULL_DAY | MORNING | AFTERNOON | EVENING
    forecasted_sales  NUMERIC(14, 2) NOT NULL,
    model_run_id      UUID NOT NULL REFERENCES forecast_model_run(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    UNIQUE (store_id, forecast_date, daypart, model_run_id)
);

CREATE INDEX idx_sales_forecast_store_date ON sales_forecast(store_id, forecast_date);

-- ----------------------------------------------------------------------------
-- LABOR_GUIDELINE
-- ----------------------------------------------------------------------------
CREATE TABLE labor_guideline (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id              UUID NOT NULL REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE,
    target_productivity   NUMERIC(14, 2),   -- e.g. target sales THB per labor hour
    target_col_percent    NUMERIC(5, 2),    -- target Cost-of-Labor % of sales
    min_staff_per_shift   NUMERIC(4, 1)
);

-- ----------------------------------------------------------------------------
-- LABOR_RECOMMENDATION
-- ----------------------------------------------------------------------------
CREATE TABLE labor_recommendation (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forecast_id        UUID NOT NULL REFERENCES sales_forecast(id)  ON UPDATE CASCADE ON DELETE CASCADE,
    guideline_id       UUID NOT NULL REFERENCES labor_guideline(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    recommended_hours  NUMERIC(8, 2) NOT NULL
);

-- ----------------------------------------------------------------------------
-- ROSTER
-- ----------------------------------------------------------------------------
CREATE TABLE roster (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id      UUID NOT NULL REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE,
    week_start    DATE NOT NULL,
    status        VARCHAR(30) NOT NULL DEFAULT 'DRAFT',  -- DRAFT | SUBMITTED | APPROVED | PUBLISHED
    approved_by   UUID REFERENCES "user"(id)         ON UPDATE CASCADE ON DELETE SET NULL,
    approved_at   TIMESTAMP,
    UNIQUE (store_id, week_start)
);

-- ----------------------------------------------------------------------------
-- SHIFT
-- ----------------------------------------------------------------------------
CREATE TABLE shift (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    roster_id      UUID NOT NULL REFERENCES roster(id)   ON UPDATE CASCADE ON DELETE CASCADE,
    employee_id    UUID NOT NULL REFERENCES employee(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    shift_date     DATE NOT NULL,
    start_time     TIME NOT NULL,
    end_time       TIME NOT NULL,
    planned_hours  NUMERIC(5, 2) NOT NULL,
    CHECK (end_time > start_time)
);

CREATE INDEX idx_shift_roster ON shift(roster_id);
CREATE INDEX idx_shift_employee_date ON shift(employee_id, shift_date);

-- ----------------------------------------------------------------------------
-- ACTUAL_HOURS
-- ----------------------------------------------------------------------------
CREATE TABLE actual_hours (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id      UUID NOT NULL REFERENCES shift(id) ON UPDATE CASCADE ON DELETE CASCADE,
    actual_hours  NUMERIC(5, 2) NOT NULL,
    clock_in      TIMESTAMP,
    clock_out     TIMESTAMP,
    recorded_by   UUID REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE SET NULL,
    UNIQUE (shift_id)
);

-- ----------------------------------------------------------------------------
-- KPI_SNAPSHOT
-- ----------------------------------------------------------------------------
CREATE TABLE kpi_snapshot (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id               UUID NOT NULL REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE,
    snapshot_date          DATE NOT NULL,
    productivity           NUMERIC(14, 2),   -- sales per labor hour
    col_percent            NUMERIC(5, 2),    -- cost of labor as % of sales
    remaining_labor_hours  NUMERIC(8, 2),
    forecast_accuracy      NUMERIC(5, 4),
    sales_performance      NUMERIC(6, 2),    -- actual vs target, e.g. 0.9750 = 97.5%
    UNIQUE (store_id, snapshot_date)
);

CREATE INDEX idx_kpi_snapshot_store_date ON kpi_snapshot(store_id, snapshot_date);

-- ============================================================================
-- Seed reference data
-- ============================================================================

INSERT INTO role (name, permissions) VALUES
    ('ADMIN',         '["*"]'::jsonb),
    ('EXECUTIVE',     '["sales:view","forecast:view","productivity:view","branch:compare","labor:view"]'::jsonb),
    ('AREA_COACH',    '["sales:view","forecast:view","productivity:view","branch:compare"]'::jsonb),
    ('STORE_MANAGER', '["sales:view","forecast:view","schedule:generate","schedule:update","labor:input","labor:view","productivity:view"]'::jsonb);

INSERT INTO sales_source_type (name) VALUES
    ('POS_IMPORT'),
    ('MANUAL_ENTRY'),
    ('EXCEL_IMPORT');

-- ============================================================================
-- End of schema
-- ============================================================================
