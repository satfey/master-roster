-- Links a login to the area_coach it represents.
--
-- store.area_coach_id already records which coach owns each store, but nothing recorded the
-- reverse direction, so an AREA_COACH login resolved to zero stores and storeScope rejected
-- every request. The user-credentials migration (20260901) was meant to add this column but
-- only its password_hash half ever reached this database.
--
-- authenticate.js prefers this column and falls back to matching user.full_name against
-- area_coach.name, so applying this migration is optional — it just makes the link explicit
-- and immune to a coach being renamed.

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS area_coach_id uuid REFERENCES area_coach (id);

CREATE INDEX IF NOT EXISTS user_area_coach_id_idx ON "user" (area_coach_id);

-- Backfill from the name match the application currently relies on. Only unambiguous matches
-- are filled in; a name shared by two coaches is left NULL rather than guessed at.
UPDATE "user" u
SET area_coach_id = c.id
FROM area_coach c
WHERE u.area_coach_id IS NULL
  AND lower(u.full_name) = lower(c.name)
  AND (SELECT count(*) FROM area_coach c2 WHERE lower(c2.name) = lower(u.full_name)) = 1;
