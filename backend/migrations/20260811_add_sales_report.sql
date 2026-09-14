
CREATE TABLE sales_report (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id                      UUID NOT NULL REFERENCES store(id)             ON UPDATE CASCADE ON DELETE CASCADE,
    report_store_id               INTEGER NOT NULL,   
    store_bu_id                   INTEGER,            
    store_name                    VARCHAR(150),       
    week                          VARCHAR(20),        

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
    entered_by                     UUID REFERENCES users(id)                    ON UPDATE CASCADE ON DELETE SET NULL,
    created_at                     TIMESTAMP NOT NULL DEFAULT now(),


    UNIQUE (store_id, report_date)
);
