-- Adds updated_at to sales_report so an overwrite (re-uploading a report for
-- a (store_id, report_date) that already exists) can be told apart from the
-- original import. created_at is never touched by that overwrite — it still
-- reflects when the row was first inserted; updated_at reflects the most
-- recent import that touched it. Run manually against the live Supabase DB
-- (this repo has no migration runner — apply via the Supabase SQL editor).
ALTER TABLE sales_report
    ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT now();
