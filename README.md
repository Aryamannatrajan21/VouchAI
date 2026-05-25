# VouchAI

Secure AI-assisted financial vouching for auditors. The app encrypts uploaded files in the browser, stores encrypted blobs in Supabase Storage, and uses a Node API to decrypt in memory for controlled AI processing and review.

## Production Readiness Baseline

- Frontend API calls use Supabase bearer tokens.
- Backend API routes verify tokens with Supabase Auth before returning decrypted data.
- Batch, result, and document endpoints enforce owner/admin/auditor access checks.
- Server CORS is allowlist-based through `CORS_ORIGINS`.
- Encryption fails closed when `ENCRYPTION_SECRET` is missing or too short.
- Local DB scripts use `SUPABASE_DB_URL` instead of committed credentials.

## Local Setup

1. Install frontend dependencies:

   ```bash
   npm install
   ```

2. Install backend dependencies:

   ```bash
   npm install --prefix server
   ```

3. Create environment files:

   ```bash
   cp .env.example .env.local
   cp server/.env.example server/.env
   ```

4. Fill in Supabase, NVIDIA, and encryption values.

5. Start the backend:

   ```bash
   node server/server.js
   ```

6. Start the frontend:

   ```bash
   npm run dev
   ```

## Required Environment

Frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL`

Backend:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NVIDIA_API_KEY`
- `ENCRYPTION_SECRET`
- `CORS_ORIGINS`
- `JSON_BODY_LIMIT`

Maintenance scripts:

- `SUPABASE_DB_URL`

## Deployment Notes

- Set `CORS_ORIGINS` to the exact Vercel or production frontend origins.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `NVIDIA_API_KEY`, `ENCRYPTION_SECRET`, and `SUPABASE_DB_URL` out of the browser and out of git.
- Rotate any database password that has ever been committed or shared locally.
- Use private Supabase buckets and RLS policies for all tenant-owned tables.
- Run `npm run lint` and `npm run build` before deploy.
