# FEFO Smart Picking & Picklist Generator

Facility-level picklist engine for warehouse dispatch. Upload stock, pick a location,
enter demand by SKU, and the app applies **FEFO + channel-wise dispatch tolerance**,
suggests bins in a **critical pick path**, **soft-blocks** the stock under a **master
picklist number**, and lets you **complete in one click** with **not-found captured at
the quantity level** — then raises a gatepass and reports fill rate.

**Stack:** React + Vite + TypeScript + Tailwind CSS · Supabase (Postgres) for shared
data · deploys from GitHub.

---

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints. With no Supabase keys it runs in **Local mode** (data saved
in your browser) — good for demos.

## Build

```bash
npm run build      # type-checks, then builds to dist/
npm run preview    # serve the production build
```

## Connect Supabase (shared multi-user data)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the dashboard → **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql).
3. Copy `.env.example` to `.env` and paste your **Project URL** and **anon key**
   (Project Settings → API).
4. Restart `npm run dev`. The header shows **"Supabase connected"**.

> The database views `stock_available` and `feed_frozen` implement the soft-block and
> inventory-freeze rules so many users share one correct stock view.

## Deploy from GitHub (GitHub Pages)

1. Push this folder to a GitHub repo (`main` branch).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. (Optional, for shared data) add repo secrets `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions).
4. Every push to `main` builds and publishes automatically
   (`.github/workflows/deploy.yml`). Your live link appears under the Pages settings.

## Phase plan

- **Phase 1** — inventory from the **daily auto-generated email** (loaded into `stock`).
- **Phase 2** — swap the email feed for the **Inventory API**; nothing else changes.
- Handheld (HHT) scan-picking is intentionally out of scope for now.

## Project layout

```
src/lib/        engine (FEFO + tolerance + critical path), channels, store, types
src/components/ Stock, Demand, Register, Performance panels + shared UI
supabase/       schema.sql (tables, soft-block & freeze views)
.github/        Pages deploy workflow
```
