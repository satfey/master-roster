-- Renames the `users` table to `user`.
--
-- RESERVED WORD WARNING: `user` is a reserved word in PostgreSQL. Every raw
-- SQL reference to this table must be double-quoted as "user" — unquoted,
-- `user` parses as the CURRENT_USER function and silently returns the current
-- database role instead of touching the table:
--
--     SELECT * FROM user;     -- ERROR / current_user, NOT the table
--     SELECT * FROM "user";   -- correct
--
-- Application code is unaffected: the Supabase client (PostgREST) quotes
-- identifiers itself, so supabase.from('user') needs no special handling.
-- Only hand-written SQL (this file, the Supabase SQL editor, psql) does.
--
-- Foreign keys do NOT need to be recreated: Postgres tracks dependencies by
-- object id, not by name, so every existing `entered_by`/`recorded_by`
-- REFERENCES users(id) constraint follows the rename automatically. The
-- tables carrying one are sales_report, sales_by_hour, whr_target_monthly and
-- store_actual_hours.
--
-- No migration runner in this repo — apply manually via the Supabase SQL
-- editor.

BEGIN;

ALTER TABLE users RENAME TO "user";

-- Constraint and index names are cosmetic (they don't follow the rename), but
-- leaving `users` in them is misleading. Renamed here so the schema reads
-- consistently; skip this block if the names differ in your database.
ALTER TABLE "user" RENAME CONSTRAINT fk_users_store TO fk_user_store;

COMMIT;

-- Verify after applying:
--   SELECT count(*) FROM "user";
--   SELECT conname FROM pg_constraint WHERE conrelid = '"user"'::regclass;
