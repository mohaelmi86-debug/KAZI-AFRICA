# KAZI AFRICA V1.1 — FINAL SECURITY VALIDATION

**Date:** 2026-11-18  
**Scope:** Full Express backend (`server.ts`), authentication & RBAC middleware (`src/middleware/auth.ts`), business logic (`src/server/businessLogic.ts`), PostgreSQL schema (`src/db/schema.ts`), Gemini AI proxy (`src/server/geminiService.ts`), and PWA cache boundaries (`vite.config.ts`).  
**Verification Basis:** Independent source inspection + automated integration suites (`tests/kazi.test.ts`: 8/8 passed; `tests/v1_1_validation.test.ts`: 5/5 subtests passed) + live HTTP smoke checks on port 3000.

---

## 1. Executive Summary & Control Matrix

| Security Domain | Enforcement Mechanism | Verification Status |
|---|---|---|
| **Firebase Token Verification & Revocation** | `adminAuth.verifyIdToken(token, CHECK_FIREBASE_REVOKED)` verifies cryptographic JWT signatures locally via Google public JWKS (`FIREBASE_CHECK_REVOKED=false` default so no Identity Toolkit IAM call fails in Starter Tier / AI Studio previews; PostgreSQL `profiles.is_suspended` enforces instant lockout; `401` handler preserved for `auth/id-token-revoked` when `FIREBASE_CHECK_REVOKED=true` with `roles/firebaseauth.viewer`) | **Tested and passed** (JWKS check & synthetic revocation `401` mock; live Identity Toolkit revocation `Requires external validation` with IAM role) |
| **RBAC Enforcement** | `requireAuth` + `requireAnyRole([...])` on every admin, role, dispute, refund, course-admin, and analytics route; `SUPER_ADMIN` role cannot self-escalate via `/api/auth/active-role` | **Tested and passed** |
| **Organization-Level Isolation (B2B)** | `org.ownerProfileId === ctx.profileId` or active `org_members` membership verified before creating B2B missions, adding members, or assigning technicians | **Tested and passed** |
| **Country-Level `LOCAL_ADMIN` Isolation** | `ctx.adminCountryIso2s` checked on `/api/admin/overview`, `/api/admin/users`, `/api/admin/users/:id/suspend`, `/api/admin/verifications/:id/review`, `/api/admin/disputes/:id/resolve`, `/api/payments/:id/refund`, `/api/countries/:iso2/config` | **Tested and passed** (`SN` admin blocked `403` on `CI` overview, config, and refund) |
| **IDOR Protection** | Mission, quote, booking, payment, review, message, dispute, and passport routes verify ownership/participant relation (`403` on non-participants) | **Tested and passed** |
| **UUID Path/Body Validation** | Strict `UUID_REGEX` validation via `isValidUuid()` before SQL queries across all `:id` routes and UUID body fields (`400` instead of `500`) | **Tested and passed** |
| **Professional Self-Verification Lock** | `/api/professionals/register` ignores client-supplied `isVerified` and hardcodes `isVerified: false`; only `SUPER_ADMIN` or scoped `LOCAL_ADMIN` via `/api/admin/verifications/:id/review` can set `isVerified: true` | **Tested and passed** |
| **Booking State Transitions & Actor Locks** | `canTransitionBooking()` + `canActorTransitionBooking()` inside `db.transaction` with optimistic status compare-and-set (`and(eq(bookings.id, id), eq(bookings.status, status))`) | **Tested and passed** |
| **Payment & Refund Permissions** | Payments require booking payer/admin ownership; refunds restricted to `SUPER_ADMIN` and country-scoped `LOCAL_ADMIN`; atomic `CONFIRMED_SERVER -> REFUNDED` update prevents double refund | **Tested and passed** |
| **HTTP Security Headers & CORS** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Strict-Transport-Security` (in production), explicit CORS origin whitelist, `Cache-Control: no-store, private` on private `/api/*` | **Tested and passed** |
| **Rate Limiting** | In-memory sliding window (`180 req/min` on `/api`, `20 req/min` on `/api/ai/*`) emitting `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` on `429` | **Tested and passed** |
| **PWA Cache Isolation** | Workbox `navigateFallbackDenylist: [/^\/api\//]` + `NetworkOnly` rule on all private `/api/*` endpoints + `kazi-api*` runtime cache purge on `signOut()` | **Tested and passed** (verified in `dist/sw.js`) |

---

## 2. Verified V1.1 Security Defects Found & Remediated

1. **[HIGH -> FIXED] Drizzle `DrizzleQueryError` Unwrapping for PostgreSQL `23505` Violations**
   - **Finding:** In `server.ts`, duplicate review (`POST /api/reviews`), concurrent quote acceptance (`POST /api/quotes/:id/accept`), and concurrent KAZI Skills enrollment (`POST /api/skills/enroll`) checked `err?.code === '23505'`. Drizzle ORM 0.45.x wraps the `pg` driver error under `err.cause.code`, causing duplicate-key constraints to fall through to `500 Internal Server Error` during independent concurrency/regression testing.
   - **Fix:** Added `isPgUniqueViolation(err)` checking `err?.code === '23505' || err?.cause?.code === '23505'` across `/api/quotes/:id/accept` (`409`), `/api/payments/initiate` (`200` idempotent replay), `/api/reviews` (`409`), `/api/enterprise/members` (`409`), and `/api/skills/enroll` (plus atomic `.onConflictDoNothing().returning()` inside `db.transaction`).
   - **Verification:** **Tested and passed** (`tests/v1_1_validation.test.ts` subtests 2 & 3).

2. **[HIGH -> FIXED] Payment Failure Webhook State Regression (`CONFIRMED_SERVER` -> `FAILED` HTTP Semantics)**
   - **Finding:** `failPaymentServerSide()` previously returned the existing payment with HTTP `200` if a delayed `FAILED` webhook arrived after `CONFIRMED_SERVER` or `REFUNDED`, rather than explicitly rejecting invalid terminal-state regressions.
   - **Fix:** Updated `failPaymentServerSide()` in `src/server/businessLogic.ts` to remain idempotent when already `FAILED` and explicitly reject state regressions from `CONFIRMED_SERVER` or `REFUNDED` (`400`, leaving `CONFIRMED_SERVER` untouched in PostgreSQL).
   - **Verification:** **Tested and passed** (`tests/v1_1_validation.test.ts` subtest 2).

3. **[MEDIUM -> HARDENED] Webhook Replay Protection & Timestamp Window (`±300s`)**
   - **Finding:** Production payment webhooks require anti-replay protection against captured valid HMAC payloads.
   - **Fix:** Enforced `X-Kazi-Timestamp` (`±300s` replay window, mandatory when `NODE_ENV === 'production'`) and `X-Kazi-Delivery-Id` bounded replay deduplication cache (`WEBHOOK_REPLAY_TTL_MS = 10 min`), plus `express.json({ verify })` raw-byte HMAC verification (`${timestamp}.${rawBody}` or `rawBody`).
   - **Verification:** **Tested and passed** (`tests/v1_1_validation.test.ts` subtest 2).

4. **[MEDIUM -> HARDENED] Request Correlation, Sanitized JSON Parse Errors & Private API Cache Headers**
   - **Fix:** Added `trust proxy = 1`, `X-Request-Id` propagation, sanitized `400` handler for malformed JSON (`entity.parse.failed` without stack leaks), and `Cache-Control: no-store, private` + `Pragma: no-cache` on all authenticated/private `/api/*` routes.
   - **Verification:** **Tested and passed** on both `http://127.0.0.1:3000` live server and `tests/v1_1_validation.test.ts` subtest 1.

---

## 3. Residual Security Risks & External Validation Dependencies

- **In-Memory Rate Limit & Webhook Replay Store (MEDIUM — Multi-Instance Scaling):** Both `rateLimitStore` and `webhookReplayCache` reside in Node.js process memory. Under single-instance Cloud Run pilot operation this is effective; before scaling to multiple concurrent backend replicas, move rate limiting and webhook delivery-ID deduplication to Redis/Memorystore or PostgreSQL-backed tables (`webhook_deliveries`).
- **Live Firebase Revocation & CSP Policy (`Requires external validation`):** Firebase revocation handling was verified with mocked `auth/id-token-revoked` exceptions; live Google Identity Platform revocation propagation and domain-specific Content-Security-Policy tuning should be validated against the production Firebase Auth domain.
- **Database Role Privilege Verification (VERIFIED):** Runtime DB user (`cloud_sql_development_database`) was verified to obey least privilege (cannot execute `CREATE SCHEMA` — `42501: permission denied`).
