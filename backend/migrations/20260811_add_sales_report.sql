-- Creates the sales_report table. Run manually against the live Supabase DB
-- (this repo has no migration runner — apply via the Supabase SQL editor).
--
-- Store lookup uses the EXISTING store.storeCode VARCHAR(4) column — the
-- report's integer "Store Id" (col B) is matched via String(reportStoreId)
-- against storeCode. No new column is added to `store`.

CREATE TABLE sales_report (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id                      UUID NOT NULL REFERENCES store(id)             ON UPDATE CASCADE ON DELETE CASCADE,
    report_store_id               INTEGER NOT NULL,   -- col B, raw Excel "Store ID", kept for traceability
    store_bu_id                   INTEGER,            -- col A, denormalized (no BU table)
    store_name                    VARCHAR(150),       -- col C, denormalized as-imported (may differ from store.name)
    week                          VARCHAR(20),        -- col D, e.g. "2026-27" — not numeric, preserved as-is

    report_date                   DATE NOT NULL,      -- col E

    gross_actual                  NUMERIC(14, 2),     -- col F
    gross_budget                  NUMERIC(14, 2),     -- col G
    gross_variance_percent        NUMERIC(7, 4),      -- col H
    gross_actual_ly               NUMERIC(14, 2),     -- col I
    gross_ly_variance_percent     NUMERIC(7, 4),      -- col J
    gross_actual_mtd              NUMERIC(14, 2),     -- col K
    gross_budget_mtd              NUMERIC(14, 2),     -- col L
    gross_mtd_variance_percent    NUMERIC(7, 4),      -- col M
    gross_actual_ly_mtd           NUMERIC(14, 2),     -- col N

    docket_actual                 INTEGER,            -- col O
    docket_budget                 INTEGER,            -- col P
    docket_variance_percent       NUMERIC(7, 4),      -- col Q
    docket_actual_ly              INTEGER,            -- col R
    docket_ly_variance_percent    NUMERIC(7, 4),      -- col S

    customer_actual                INTEGER,           -- col T
    customer_budget                INTEGER,           -- col U
    customer_variance_percent      NUMERIC(7, 4),     -- col V
    customer_actual_ly             INTEGER,           -- col W
    customer_ly_variance_percent   NUMERIC(7, 4),     -- col X

    other_sales                   NUMERIC(14, 2),     -- col Y
    service_charge                 NUMERIC(14, 2),    -- col Z

    source_type_id                UUID NOT NULL REFERENCES sales_source_type(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    entered_by                     UUID REFERENCES users(id)                    ON UPDATE CASCADE ON DELETE SET NULL,
    created_at                     TIMESTAMP NOT NULL DEFAULT now(),

    -- Also serves as the lookup index for duplicate-row detection; a separate
    -- explicit index would just duplicate this constraint's backing btree.
    UNIQUE (store_id, report_date)
);
