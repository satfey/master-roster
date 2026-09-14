
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS area_coach_id uuid REFERENCES area_coach (id);

CREATE INDEX IF NOT EXISTS user_area_coach_id_idx ON "user" (area_coach_id);


UPDATE "user" u
SET area_coach_id = c.id
FROM area_coach c
WHERE u.area_coach_id IS NULL
  AND lower(u.full_name) = lower(c.name)
  AND (SELECT count(*) FROM area_coach c2 WHERE lower(c2.name) = lower(u.full_name)) = 1;
