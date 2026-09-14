
BEGIN;

ALTER TABLE users RENAME TO "user";

ALTER TABLE "user" RENAME CONSTRAINT fk_users_store TO fk_user_store;

COMMIT;


