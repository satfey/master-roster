-- Adds the meal/rest break window to `shift`. A Full-time shift is 8 PAID
-- WORKING hours + 1 hour unpaid break = 9 clock hours (e.g. 09:00-18:00 with
-- a break 13:00-14:00) — planned_hours continues to mean WORKING hours only
-- (unchanged meaning, every cost/productivity/cap calculation already
-- treats it that way), so the break needs its own columns rather than being
-- folded into start_time/end_time. Nullable — only Full-time shifts get a
-- break; Part-time rows leave both null. Run manually against the live
-- Supabase DB (this repo has no migration runner — apply via the Supabase
-- SQL editor).
ALTER TABLE shift
    ADD COLUMN break_start_time TIME,
    ADD COLUMN break_end_time   TIME;
