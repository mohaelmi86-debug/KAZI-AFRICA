# KAZI AFRICA V1.1 — DATABASE RECOVERY & INTEGRITY REPORT

**Date:** 2026-11-18  
**Engine:** PostgreSQL (Google Cloud SQL, `europe-west2`) via `pg` + Drizzle ORM (`0.45.4`)  
**Scope:** Non-destructive logical backup, isolated restore verification, foreign-key & unique-index integrity, concurrency safety, and schema parity.

---

## 1. Non-Destructive Logical Backup & Isolated Restore Proof

Executed against live Cloud SQL PostgreSQL (`public` schema) without modifying or deleting any existing business records:

- **Schema Scope:** All **40 tables** in `public` (`audit_logs`, `booking_status_history`, `bookings`, `certifications`, `cities`, `commissions`, `countries`, `country_admins`, `country_currencies`, `country_deployments`, `country_modules`, `country_payment_providers`, `disputes`, `enrollments`, `evaluations`, `languages`, `messages`, `missions`, `notifications`, `org_members`, `organizations`, `payment_transactions`, `payments`, `permissions`, `platform_settings`, `professional_availability`, `professional_services`, `professional_skills`, `professionals`, `profiles`, `quotes`, `refunds`, `reviews`, `service_categories`, `skill_passports`, `skills`, `support_tickets`, `training_courses`, `user_roles`, `verifications`).
- **Exported Logical Snapshot Size:** `234,480` bytes JSON across **809 total rows** (`SHA-256` prefix: `76ae9361a17e7059`).
- **Isolated Restore Mechanism:** Created 40 session-scoped `TEMP TABLE` replicas (`LIKE "public"."<table>" INCLUDING CONSTRAINTS INCLUDING INDEXES`), restored 100% of serialized rows via parameterized `INSERT` statements, and compared per-table row counts against `public`.
- **Result:** **Tested and passed** — `mismatches: []` (40/40 tables matched identically; 809/809 rows restored in `6,366.42 ms`; temporary tables auto-dropped on session close).
- **Least-Privilege Finding:** Attempting `CREATE SCHEMA "kazi_recovery_tmp"` as runtime `SQL_USER` returned PostgreSQL `42501: permission denied for database`, confirming the runtime application role cannot execute database-level DDL/schema creation.

---

## 2. Live PostgreSQL Baseline State & Structural Constraints

Verified directly via `cloudsql.ExecuteSql` and `information_schema` / `pg_indexes` after all automated tests completed:

| Metric | Observed Count | Notes |
|---|---|---|
| **Public Tables** | `40` | Synced via `cloudsql.UpdateSchema` with zero data loss |
| **Foreign Key Constraints** | `60` | Referential integrity active across all operational entities |
| **Unique Indexes** | `58` | Includes V1.1 composite guards (`bookings_mission_id_unique_idx`, `enrollments_course_profile_unique_idx`, `org_members_org_profile_unique_idx`, `country_psp_country_provider_unique_idx`) |
| **Total `public` Indexes** | `79` | Includes 21 B-tree lookup indexes added/verified for high-frequency queries |
| **Countries / Deployments / PSPs** | `54` / `54` / `216` | Full 54-country referential populated with `name_pt` across 54/54 rows |
| **Pre-existing Business Data** | `7` profiles, `5` pros, `4` missions, `2` bookings, `1` payment, `3` courses | **100% preserved** |
| **Leftover Test Records (`test-%`, `[TEST-%`)** | `0` / `0` | Clean teardown verified in `public` |

---

## 3. Concurrency & Race-Condition Protection Tested Against Live PostgreSQL

1. **5x Concurrent Quote Acceptance (`POST /api/quotes/:id/accept`):**
   - Verified atomic mission claim (`WHERE status IN ('REQUESTED', 'QUOTED')`) + `bookings_mission_id_unique_idx` inside `db.transaction`.
   - Result: **Strictly `1 × 201 Created` and `4 × 409 Conflict`**, with exactly `1` booking row persisted in PostgreSQL (**Tested and passed**).
2. **4x Concurrent Course Enrollment (`POST /api/skills/enroll`):**
   - Verified `ON CONFLICT DO NOTHING` on `enrollments_course_profile_unique_idx` + `READ COMMITTED` fallback select inside `db.transaction`.
   - Result: **All 4 HTTP calls succeeded (`1 × 201`, `3 × 200 alreadyEnrolled`)** and `training_courses.enrolled_count` incremented by strictly **`+1`** (**Tested and passed**).
3. **Duplicate Review Submission (`POST /api/reviews`):**
   - Verified `reviews.booking_id` unique constraint mapped cleanly via `isPgUniqueViolation` to **`409 Conflict`** (**Tested and passed**).
4. **Legacy Duplicate Observation (Non-Destructive):**
   - `user_roles` retains 1 pre-existing legacy duplicate row (`role: 'PROFESSIONAL'`, `country_iso2: null`) from V1, untouched to honor the non-destructive data rule. `grantUserRoleSafely()` prevents any recurrence.

---

## 4. Managed Disaster Recovery Status (`Requires external validation`)

- **Cloud SQL Automated Backups & Point-in-Time Recovery (PITR):** Managed GCP Cloud SQL automated daily snapshot schedule, transaction log retention window, and cross-region backup replication are infrastructure-level controls outside the application codebase and **Require external validation** in the Google Cloud Console before public launch.
- **Connection Pool Config:** `src/db/index.ts` configures `pg.Pool({ max: 10, connectionTimeoutMillis: 15000 })` with idle error listener; no SSL/TLS client cert configuration is hardcoded (managed via Cloud SQL private proxy/runtime environment).
