# API Documentation

Base URL: `/api` (interactive Swagger UI also served at `/api-docs`).

> **Auth note:** login is deferred (see README §6). No endpoint currently
> requires an `Authorization` header — every request is treated as a fixed
> Admin-equivalent system identity. The route-level permission checks below
> describe the *intended* RBAC once login exists; right now they all pass.

All responses follow a consistent envelope:

```json
{ "success": true, "message": "OK", "data": { } }
```

## Auth (stubbed)

### `POST /login`
Not implemented yet — returns `501`. See README §6.

### `GET /me`
Returns the current identity (the fixed system identity for now).

## Sales Forecast

### `POST /forecast`
Generate and persist a sales forecast, recording a `ForecastModelRun`.
**Body**: `{ "storeId": "uuid", "days": 7, "method": "SMA" | "LINEAR_REGRESSION" }`
**Permission (future)**: `forecast:generate`

### `GET /forecast?storeId=...&from=2026-07-01&to=2026-07-31`
Retrieve stored `SalesForecast` rows. **Permission (future)**: `forecast:view`

## Roster (auto schedule generator)

### `POST /roster/auto-generate`
The only supported roster-generation endpoint (the earlier fixed-template
`POST /roster/generate` has been removed). Auto-generates a DRAFT roster over
a date range: Full-time shifts are exactly 8 working hours + a 1-hour meal
break (9-hour clock span), Part-time is 4-8 hours, opening (09:00, >=1
employee) and closing (22:00, >=2 employees) coverage are guaranteed, and staffing is sized from the
sales forecast, labor guideline, and monthly capacity — never auto-approved.
**Body**: `{ "storeId": "uuid", "startDate": "2026-07-27", "endDate": "2026-08-02", "regenerate": false }`
**Permission (future)**: `schedule:generate`

### `GET /roster?storeId=...`
List generated rosters for a store, with shifts + employees + actual hours.

### `GET /roster/:id`
Get one roster with full shift details.

### `PUT /roster/:id`
Update roster status or manually reassign employees to shift slots.
**Body**: `{ "status": "PUBLISHED", "shifts": [{ "id": "uuid", "employeeId": "uuid" }] }`
**Permission (future)**: `schedule:update`

### `DELETE /roster/:id`
Delete a roster and its shifts. **Permission (future)**: `schedule:delete`

## Labor Hours

### `GET /labor?storeId=...&from=...&to=...`
Planned vs. actual hours summary for a store, plus allowed/remaining hours
and labor % derived from the store's `LaborGuideline` and forecasted sales
for the same period. **Permission (future)**: `labor:view`

### `PUT /labor`
Record actual hours for a single **shift** (not a whole store/day — hours are
tracked per-shift in this schema).
**Body**: `{ "shiftId": "uuid", "actualHours": 7.5, "clockIn": "...", "clockOut": "..." }`
**Permission (future)**: `labor:input`
Returns a warning message if actual hours exceed the shift's planned hours.

## Dashboards

### `GET /dashboard`
Company/multi-store dashboard. Includes `topPerformingStore` and
`worstPerformingStore` ranked by productivity (sales per actual labor hour).
Will be scoped by role once login exists (Store Manager → own store, Area
Coach → assigned stores, Executive/Admin → all) — currently unrestricted.

### `GET /dashboard/store/:id`
Single-store productivity dashboard: sales actual/forecast, planned/actual/
allowed/remaining hours, labor %, productivity, and a sales time series for charting.

## Store

### `GET /store`
List stores.

### `POST /store` — create a store. **Permission (future)**: `branch:manage`
**Body**: `{ "name": "Bangkok Central Store", "region": "Bangkok", "areaCoachId": "uuid" }`

### `GET /store/:id` — store detail (employees, labor guidelines, area coach).
### `PUT /store/:id` — update a store.
### `PUT /store/:id/guideline` — create/update the store's labor guideline.
**Body**: `{ "targetProductivity": 4444.44, "targetColPercent": 22.5, "minStaffPerShift": 2 }`

## Employee

### `GET /employee?storeId=...`
### `POST /employee` — **Body**: `{ "storeId", "fullName", "position", "hourlyRate" }`
### `PUT /employee/:id`
### `DELETE /employee/:id` — soft-deactivate (`isActive: false`)

> Note: this schema has no `EmployeeAvailability` table, so there's no
> per-employee weekly availability endpoint — see README §5's scope note.

## Sales

### `GET /sales?storeId=...&from=...&to=...`
### `POST /sales` — create a manual sales record.
**Body**: `{ "storeId", "date", "amount", "sourceTypeName": "MANUAL_ENTRY" }`

## Excel Import (multipart/form-data, field name `file`)

### `POST /sales/import`
Columns: `storeName, date, amount` — tagged with source type `EXCEL_IMPORT`.

### `POST /employee/import`
Columns: `fullName, storeName, position, hourlyRate`

### `POST /store/import`
Columns: `name, region`

> Note: stores are matched **by exact name** (this schema has no unique store
> "code" column) — see README §7 for why, and consider adding one back if you
> need more robust matching.

Each import returns `{ imported, total, errors: [{ row, message }] }`.

## Users (Admin)

### `GET /user` — list users, with role + store.
### `POST /user` — create a user. **Body**: `{ "fullName", "email", "roleId", "storeId" }`
### `PUT /user/:id` — update a user (role, store, active status).

> No password handling yet — see README §6.

## Error format

```json
{ "success": false, "message": "Store not found", "errors": null }
```

| Status | Meaning |
|--------|---------|
| 400 | Validation error |
| 404 | Resource not found |
| 501 | Not implemented (currently just `/login`) |
| 500 | Unexpected server error |

(401/403 codes exist in the middleware but aren't reachable yet since
`authenticate` never rejects a request — see README §6.)
