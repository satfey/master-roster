-- WHR Target Import: one row per (store, month) of business-reported monthly
-- results — WHRS (working hours actually used that month), Productivity,
-- COG (Cost of Goods, in BAHT), and Sales. Traced first: no existing table
-- captures these together. `sales_report` has daily gross_actual/gross_budget
-- (summable to a month, but never Productivity or COG). `labor_guideline`
-- holds only per-store TARGETS (target_productivity, target_col_percent —
-- Cost of LABOR, a different metric from Cost of Goods), has no unique
-- constraint on store_id, and isn't a per-month table at all. `sales_by_hour`
-- is the closest precedent for shape (a real per-store-per-period import
-- table with an upsert-is-the-source-of-truth convention) — this follows it.
--
-- store_id is VARCHAR(50) REFERENCES store(id), not UUID: store.id was
-- migrated to be the literal Excel Store ID directly (see
-- 20260819_store_id_source_identity.sql), which every table added since
-- (sales_by_hour, labor_guideline) already follows.
--
-- cog_percent is stored, not left to be recomputed on every read — it's
-- cheap to compute (cog / sales) but is also exactly the value every query
-- of this table cares about (the 33% ceiling), and NULL when sales = 0
-- (division avoided, never a fabricated 0% or Infinity).
--
-- No migration runner in this repo — apply manually via the Supabase SQL
-- editor.
CREATE TABLE whr_target_monthly (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id       VARCHAR(50) NOT NULL REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE,
    report_store_id INTEGER,            -- raw Excel "CODE", kept for traceability (matches sales_by_hour's report_store_id convention)
    store_name     VARCHAR(150),        -- denormalized as-imported (may differ from store.name) — matches sales_by_hour
    report_month   DATE NOT NULL,       -- 1st of the month this file's PERIOD covers
    whrs           NUMERIC(10, 2),      -- monthly working hours actually used
    productivity   NUMERIC(10, 2),      -- monthly productivity
    cog            NUMERIC(14, 2),      -- monthly Cost of Goods, in BAHT
    sales          NUMERIC(14, 2),      -- monthly sales, in BAHT
    cog_percent    NUMERIC(6, 4),       -- cog / sales; NULL when sales = 0 (never divided by zero)
    source_type_id UUID NOT NULL REFERENCES sales_source_type(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    entered_by     UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (store_id, report_month)
);

CREATE INDEX idx_whr_target_monthly_store_month ON whr_target_monthly (store_id, report_month);
