# Master Roster — AI Workforce Scheduling System

Master Roster replaces manual, paper-based store scheduling with a decision-support
web app that forecasts sales, auto-generates rosters (shifts) inside a labor-hour
budget, tracks actual vs. planned hours, and gives every level of the org visibility
into labor efficiency.

This is a **decision-support system, not a payroll system**.

> **⚠️ Current status: login is deferred.** The schema below (matching the ERD you
> supplied) doesn't include a password/credentials table yet, so the API currently
> runs with a fixed "system" identity that has full access — every screen and
> endpoint works without signing in. See [§6 Authentication](#6-authentication-status)
> for what's stubbed vs. real, and how to re-enable it later.

## 1. System Architecture

```
┌────────────────┐        HTTPS/JSON        ┌────────────────────┐        SQL       ┌──────────────┐
│  React Frontend │ ───────────────────────▶ │  Express REST API   │ ───────────────▶ │  PostgreSQL     │
│  (Vite, Tailwind,│ ◀─────────────────────── │  (fixed identity     │ ◀─────────────── │  (Prisma ORM)   │
│  Chart.js)       │                          │  until login exists) │                  └──────────────┘
└────────────────┘                          └──────────┬──────────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │  Services layer      │
                                              │  - forecastService   │
                                              │  - rosterService      │
                                              │  - laborService        │
                                              │  - dashboardService     │
                                              │  - importService         │
                                              └────────────────────────┘
```

- **Frontend**: React + Vite SPA, TailwindCSS design system, role-flavored navigation (currently unrestricted — see §6), Chart.js visualizations.
- **Backend**: Node.js + Express, MVC-style (`routes → controllers → services → Prisma`), RBAC middleware scaffolding (currently bypassed), Swagger docs at `/api-docs`.
- **Database**: PostgreSQL via Prisma ORM, schema matching `master_roster_erd.html` exactly. See `docs/DatabaseDesign.md`.
- **Deployment target**: Frontend → Vercel, Backend → Render, Database → Railway PostgreSQL (or Supabase/Neon).

## 2. Folder Structure

```
master-roster/
├── backend/
│   ├── prisma/            # schema.prisma, seed.js
│   ├── src/
│   │   ├── controllers/   # thin request/response handlers
│   │   ├── services/      # business logic (forecast, roster, labor, dashboard, import)
│   │   ├── routes/        # Express routers + Swagger JSDoc
│   │   ├── middleware/    # authenticate (stubbed), authorize, storeScope, errorHandler
│   │   ├── utils/         # apiResponse, activityLogger (console-only for now)
│   │   └── config/        # prisma client, swagger config
│   ├── server.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/         # CompanyDashboard, StoreDashboard, Roster, Productivity, LaborTracking, Admin/*
│   │   ├── layouts/        # DashboardLayout (sidebar nav)
│   │   ├── components/     # StatCard, LaborBadge
│   │   ├── context/         # AuthContext (fixed system identity — see §6)
│   │   └── services/         # axios api client
│   └── package.json
└── docs/
    ├── API.md
    ├── DatabaseDesign.md   # ERD + table notes
    ├── Diagrams.md         # sequence diagrams
    ├── DEPLOYMENT.md
    ├── TESTING.md
    └── FUTURE.md
```

## 3. Getting Started

### Database

You need a PostgreSQL instance. Easiest options with no local install:
[Neon](https://neon.tech) or [Supabase](https://supabase.com) (free tiers), or
install PostgreSQL locally / use Railway PostgreSQL for deployment.

The schema uses `gen_random_uuid()` for primary keys, which needs the
`pgcrypto` extension. **Enable it once, before your first migration:**

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

(Run that against your database via psql, your provider's SQL console, or a
GUI like pgAdmin/TablePlus.)

### Backend

```bash
cd backend
cp .env.example .env        # set DATABASE_URL to your postgresql:// connection string
npm install
npx prisma migrate dev --name init
npm run seed                 # creates roles, source types, a demo store + guideline + users + employees
npm run dev                  # http://localhost:4000  (Swagger: /api-docs)
```

### Frontend

```bash
cd frontend
npm install
npm run dev                  # http://localhost:5173, proxies /api to :4000
```

Open `http://localhost:5173` — no login needed right now, you'll land straight
on the Company Dashboard.

## 4. Roles (as designed — not yet enforced per-user)

| Role          | Scope                        | Intended access                                                      |
|---------------|-------------------------------|------------------------------------------------------------------------|
| Store Manager | Own store only                | View sales, generate roster, record actual hours, view productivity   |
| Area Coach    | Assigned stores only          | View sales/forecast/productivity, compare stores (read-only)          |
| Executive     | Company-wide                  | Read-only: company dashboard, store dashboard, forecast, productivity |
| Admin         | Company-wide, full access     | Manage users/stores/employees, import Excel, manage labor guidelines  |

`Role.permissions` (a JSON array) already encodes this per role in the seed
data, and the `authorize`/`storeScope` middleware already implement the
checks — they're just not reachable yet because every request currently
authenticates as a fixed Admin-equivalent identity. Once real login exists,
enforcement requires no route changes.

## 5. Sales Forecast Algorithm

Two interchangeable methods (`backend/src/services/forecastService.js`):

- **Simple Moving Average (SMA)** — averages the last 7 days of `SalesRecord.amount`.
- **Linear Regression (OLS)** — fits a trend line over the lookback window and projects forward, feeding each projected day back in.

Each run creates a `ForecastModelRun` row (model version + accuracy placeholder)
and persists daily `SalesForecast` rows linked to it.

## Roster (Auto Schedule) Algorithm

`backend/src/services/rosterService.js`:

1. **Labor budget** = `forecastedSales ÷ LaborGuideline.targetProductivity` (target
   sales THB per labor hour), or a manual override.
2. Iterates day-by-day across three **fixed shift windows** (Morning/Afternoon/Closing —
   see note below on why these aren't a configurable table yet).
3. For each shift, filters employees **not already working that day** and **under
   the 48h/week cap**, then assigns the one with the **fewest hours assigned so
   far this week** (fair distribution).
4. Stops assigning once the labor-hour budget would be exceeded.

> **Scope note vs. the original design brief**: the ERD you supplied
> (`master_roster_erd.html`) doesn't include `ShiftTemplate` or
> `EmployeeAvailability` tables, and `Employee` has no `employmentType`
> field. So, compared to an earlier draft of this system, the roster
> generator here has **no per-store shift customization**, **no
> availability filtering**, and **no full-time/part-time priority** — it's
> pure fair-distribution across active employees within fixed shift hours.
> Add those tables back to `schema.prisma` if you want that behavior restored.

## 6. Authentication status

**What's real:** the `Role`/`User`/`Store` tables, RBAC permission arrays, and
the `authorize`/`storeScope` middleware logic.

**What's stubbed:** `backend/src/middleware/authenticate.js` doesn't check a
token — it looks up any Admin-role user in the DB and attaches that identity
(or a bare fallback) to every request. `POST /login` returns `501 Not
Implemented`. The frontend's `AuthContext` mirrors this with a fixed
`SYSTEM_USER` and no real sign-in form.

**To build real login later:**
1. Add a credentials table (e.g. `user_credential` with `user_id`, `password_hash`) — the current `User` table intentionally has no password column, matching the supplied ERD.
2. Restore JWT issuance in `authController.login` (bcrypt compare → sign token).
3. Replace `authenticate.js`'s body with real token verification + DB lookup.
4. Restore the Axios request/response interceptors in `frontend/src/services/api.js` (commented out, not deleted).
5. Restore a real `AuthProvider` with `login()`/`logout()` hitting `/login`, and gate routes with a `ProtectedRoute` again.

Nothing else needs to change — routes, controllers, and RBAC checks are
already written against `req.user.permissions`/`req.user.role`, so swapping
the identity source is the only change needed.

## 7. What's not in this version (vs. the earlier design brief)

Two things were dropped when this project switched to the supplied ERD as
the source of truth, since neither has a corresponding table in it:

- **Activity Log** — no persisted audit trail right now; `logActivity()` just
  console.logs. Add an `activity_log` table back to `schema.prisma` to restore it.
- **Shift Templates / Employee Availability** — see the roster algorithm note above.

## 8. Deliverables Map

| Deliverable                | Location |
|-----------------------------|----------|
| ER Diagram / DB Schema       | `docs/DatabaseDesign.md`, `backend/prisma/schema.prisma` |
| API Documentation            | `docs/API.md`, live Swagger at `/api-docs` |
| Sequence Diagrams            | `docs/Diagrams.md` |
| Forecast Algorithm           | §5 above, `forecastService.js` |
| Roster Algorithm             | §5 above, `rosterService.js` |
| React Components             | `frontend/src/components`, `frontend/src/pages` |
| Express Routes/Controllers   | `backend/src/routes`, `backend/src/controllers` |
| Prisma Models / SQL Schema   | `backend/prisma/schema.prisma` |
| Deployment Guide             | `docs/DEPLOYMENT.md` |
| Testing Plan                 | `docs/TESTING.md` |
| Future Improvements          | `docs/FUTURE.md` |

## 9. Coding Standards

- MVC: routes stay thin, business logic lives in `services/`.
- `async/await` throughout; `express-async-errors` + central `errorHandler` for consistent error responses.
- All secrets via environment variables (`.env`, never committed).
- Prisma migrations are the single source of truth for schema changes.
- Swagger (`swagger-jsdoc` + `swagger-ui-express`) documents every route inline.
