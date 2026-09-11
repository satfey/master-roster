# Deployment Guide

## 1. Database — Supabase

The backend talks to Postgres through the Supabase client, not an ORM, so there is no
`prisma generate`/`migrate` step and no `DATABASE_URL`.

1. Create a Supabase project (or use an existing one).
2. **Enable the `pgcrypto` extension** (required for `gen_random_uuid()` primary keys) — run this once in the SQL editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   ```
3. Apply the SQL files in `backend/migrations/` in filename order, via the Supabase SQL editor.

   There is no seed step. Real data comes in through the import screens (Store Master,
   Employee Master, Sales Report, Sales by Hour, WHR Target); the roles and user accounts
   are created by hand, with `npm run hash-password "<password>"` for the `password_hash`
   column. Nothing in this repo writes invented business data to a database.

## 2. Backend — Render

1. New "Web Service" pointing at the `backend/` folder of this repo.
2. Build command: `npm install`
3. Start command: `npm start`
4. Environment variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN` (set to your Vercel frontend URL), `BCRYPT_SALT_ROUNDS`, `NODE_ENV=production`.
5. New migrations are applied through the Supabase SQL editor, not from the server.

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
