-- Lets a Store Manager add and remove employees of their OWN store from Staff Management.
--
-- POST /employee, PUT /employee/:id and DELETE /employee/:id require the `employee:manage`
-- permission. Only ADMIN had it (through "*"), so the Staff Management screen offered a Store
-- Manager add/remove buttons that could only ever return 403.
--
-- Granting the permission does NOT widen which stores they reach. That is enforced separately on
-- every one of those routes: storeScope on POST (the body's storeId must be their own store) and
-- employeeScope on PUT/DELETE (the employee must belong to their store, and a move may only target
-- their store). Area Coach deliberately does not receive it.
--
-- Idempotent: running it twice leaves a single entry.
UPDATE role
SET permissions = permissions || '["employee:manage"]'::jsonb
WHERE name = 'STORE_MANAGER'
  AND NOT permissions @> '["employee:manage"]'::jsonb;
