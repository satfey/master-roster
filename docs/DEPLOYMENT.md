# Deployment Guide

## 1. Database — Railway PostgreSQL

1. Create a new PostgreSQL instance on Railway (or use Supabase / Neon, both have free tiers).
2. Copy the generated `DATABASE_URL` connection string (format: `postgresql://user:password@host:5432/dbname?schema=public`).
3. **Enable the `pgcrypto` extension** (required for `gen_random_uuid()` primary keys) — run this once via psql or your provider's SQL console:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   ```
4. From `backend/`, run migrations against it:
   ```bash
   DATABASE_URL="postgresql://..." npx prisma migrate deploy
   DATABASE_URL="postgresql://..." npm run seed
   ```

## 2. Backend — Render

1. New "Web Service" pointing at the `backend/` folder of this repo.
2. Build command: `npm install && npx prisma generate`
3. Start command: `npm start`
4. Environment variables: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN` (set to your Vercel frontend URL), `BCRYPT_SALT_ROUNDS`, `NODE_ENV=production`.
5. After first deploy, run `npx prisma migrate deploy` via Render's shell (or a one-off job) to apply migrations in production.

## 3. Frontend — Vercel

1. Import the `frontend/` folder as a Vercel project.
2. Framework preset: Vite.
3. Environment/config: point Axios's base URL at the Render backend URL (either via a `VITE_API_URL` env var wired into `src/services/api.js`, or by configuring a Vercel rewrite from `/api/*` to the Render URL, mirroring the local Vite proxy).
4. Build command: `npm run build`; output directory: `dist`.

## 4. Post-deploy checklist

- [ ] Confirm `/api/health` returns `200` on the deployed backend.
- [ ] Confirm `/api-docs` (Swagger) loads and reflects production routes.
- [ ] Set `CORS_ORIGIN` to the exact Vercel domain (no wildcard) in production.
- [ ] **Login is deferred** (see README §6) — every request currently runs as a fixed system identity with full access. Do not deploy this publicly without adding real authentication first; anyone reaching the API can read/write everything.
- [ ] `JWT_SECRET`/`BCRYPT_SALT_ROUNDS` are kept in `.env` for when login is implemented — rotate them before that point, not now.
