
ALTER TABLE users
    ADD COLUMN password_hash TEXT,
    ADD COLUMN area_coach_id UUID REFERENCES area_coach(id) ON UPDATE CASCADE ON DELETE SET NULL;
