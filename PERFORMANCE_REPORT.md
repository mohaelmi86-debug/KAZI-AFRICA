# KAZI AFRICA V1.1 — PERFORMANCE & CONCURRENCY REPORT

**Date:** 2026-11-18  
**Measurement Method:** Automated Node.js HTTP benchmark (`tests/v1_1_validation.test.ts` subtest 5) measuring `15` sequential warm requests per endpoint against Express + live Google Cloud SQL (`europe-west2`), plus database index audit and concurrency stress tests.

---

## 1. Observed API Endpoint Latencies (`15` samples after warmup)

| Endpoint | Auth / Scope | p50 (ms) | p95 (ms) | Min (ms) | Max (ms) | Status |
|---|---|---:|---:|---:|---:|---|
| `GET /api/health` | Public (`SELECT 1` DB probe) | `8.58` | `24.15` | `6.95` | `24.15` | **Tested and passed** |
| `GET /api/skills/courses` | Public catalog | `9.23` | `12.78` | `8.47` | `12.78` | **Tested and passed** |
| `GET /api/professionals` | Public directory (`countryIso2=CI`) | `24.95` | `34.76` | `21.27` | `34.76` | **Tested and passed** |
| `GET /api/countries` | Public 54-country + deployments + PSPs join | `40.90` | `55.26` | `37.77` | `55.26` | **Tested and passed** |
| `GET /api/missions` | Authenticated user (`token-client-v11`) | `59.28` | `76.18` | `55.24` | `76.18` | **Tested and passed** |
| `GET /api/admin/overview` | Super Admin (`countryIso2=ALL`) | `89.29` | `108.61` | `75.53` | `108.61` | **Tested and passed** |

All benchmarked endpoints returned `HTTP 200` with `p95 <= 108.61 ms` against live Cloud SQL.

---

## 2. Database Indexing & Query Optimization

- **Total Indexes in `public`:** `79` (verified via `pg_indexes`), including `58` unique indexes and `21` performance B-tree indexes across:
  - `cities(country_id)`
  - `professionals(country_id, primary_category_slug)`
  - `verifications(professional_id, status)`
  - `missions(country_id, status)`, `missions(client_profile_id)`, `missions(organization_id)`
  - `quotes(mission_id)`, `quotes(professional_id)`
  - `bookings(country_status)`, `bookings(client_profile_id)`, `bookings(professional_id)`
  - `payments(booking_id)`, `payments(country_id, status)`, `payments(external_ref)`
  - `payment_transactions(payment_id)`
  - `messages(mission_id)`, `messages(sender_profile_id)`, `messages(recipient_profile_id)`
  - `notifications(profile_id)`, `disputes(country_id, status)`, `audit_logs(country_iso2, created_at)`
- **Startup Performance:** Eager seed blocking was replaced in V1 with lazy idempotent `ensureDatabaseSeeded()` middleware so Express binds port `3000` immediately.

---

## 3. Concurrency, Rate Limiting & Frontend Bundle Notes

- **Parallel Booking & Enrollment Races:** `5` concurrent `POST /api/quotes/:id/accept` calls and `4` concurrent `POST /api/skills/enroll` calls executed cleanly with strict single-winner / atomic counter accuracy (**Tested and passed**).
- **Rate Limiter Verification:** `/api/ai/*` enforces `20 req/min` (`429` + `Retry-After` verified on request 21); `/api/*` enforces `180 req/min`.
- **Frontend Bundle Size (`vite build`):** Production client JS bundle `dist/assets/index-D9D1wOEH.js` is `835.65 kB` raw / `229.59 kB` gzipped (`dist/assets/index-DrsOo7gf.css` `34.64 kB` / `7.17 kB` gzipped; `26` precached PWA entries totaling `4,110.42 KiB`).
  - **Optimization Opportunity (`LOW`):** Route-level `React.lazy()` code splitting can later split the Admin Console, Enterprise B2B, and KAZI Skills chunks below the 500 kB Vite warning threshold, though gzipped initial transfer (`~230 kB`) is well within acceptable web/3G budgets.
- **High-Traffic Load Testing (`Not tested` / `Requires external validation`):** Sustained multi-hundred-VU load testing against a Cloud Run autoscaling deployment and external Redis rate-limit store was not run in this local validation harness.
