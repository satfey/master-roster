
CREATE TABLE whr_target_monthly (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id       VARCHAR(50) NOT NULL REFERENCES store(id) ON UPDATE CASCADE ON DELETE CASCADE,
    report_store_id INTEGER,            
    store_name     VARCHAR(150),        
    report_month   DATE NOT NULL,       
    whrs           NUMERIC(10, 2),      
    productivity   NUMERIC(10, 2),      
    cog            NUMERIC(14, 2),      
    sales          NUMERIC(14, 2),      
    cog_percent    NUMERIC(6, 4),       
    source_type_id UUID NOT NULL REFERENCES sales_source_type(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    entered_by     UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (store_id, report_month)
);

CREATE INDEX idx_whr_target_monthly_store_month ON whr_target_monthly (store_id, report_month);
