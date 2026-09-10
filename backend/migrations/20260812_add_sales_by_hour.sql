

CREATE TABLE sales_by_hour (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id         UUID NOT NULL REFERENCES store(id)             ON UPDATE CASCADE ON DELETE CASCADE,
    report_store_id  INTEGER NOT NULL,  
    brand_name       VARCHAR(150),     
    report_month     DATE NOT NULL,    
    gross_sale       NUMERIC(14, 2) NOT NULL, 

    source_type_id   UUID NOT NULL REFERENCES sales_source_type(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    entered_by       UUID REFERENCES users(id)                      ON UPDATE CASCADE ON DELETE SET NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT now(),

   
    UNIQUE (store_id, report_month, hour)
);
