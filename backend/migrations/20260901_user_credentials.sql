-- Adds what real login needs on top of the existing users/role/area_coach
-- tables — no new permission model, no new tables for identity itself.
--
-- password_hash is nullable: a user row with no hash simply can never log
-- in (the login handler must treat that as invalid credentials, never crash
-- on a null hash) — this keeps any existing tooling that inserts users
-- without a password from breaking.
--
-- area_coach_id closes a real gap: store.area_coach_id already references
-- area_coach(id) (a names-only lookup table used by Store Master import),
-- but nothing linked a logged-in AREA_COACH user to which area_coach row
-- (and therefore which stores) is theirs. This reuses that existing table
-- rather than inventing a new one.
--
-- Run manually against the live Supabase DB (this repo has no migration
-- runner — apply via the Supabase SQL editor).
ALTER TABLE users
    ADD COLUMN password_hash TEXT,
    ADD COLUMN area_coach_id UUID REFERENCES area_coach(id) ON UPDATE CASCADE ON DELETE SET NULL;
