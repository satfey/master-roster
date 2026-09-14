
ALTER TABLE sales_report
    ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT now();
