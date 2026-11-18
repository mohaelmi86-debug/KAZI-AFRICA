# KAZI AFRICA V1.1 — PAYMENT RELIABILITY REPORT

**Date:** 2026-11-18  
**Scope:** Payment initiation (`/api/payments/initiate`), HMAC-SHA256 webhook reconciliation (`/api/payments/webhook`), Sandbox reconciliation (`/api/payments/:id/sandbox-confirm`), commission ledger (`commissions`), audit trail (`payment_transactions`), and administrative refunds (`/api/payments/:id/refund`).  
**Sandbox Policy:** **Zero real external money collection enabled.** `card_stripe` and `mobile_money` across active markets (`CI`, `SN`, `KM`) remain strictly in `SANDBOX` mode; all other 51 countries remain `UNVERIFIED` or `DISABLED` for online collection.

---

## 1. Payment Integrity Controls Verified

| Control | Implementation | Status |
|---|---|---|
| **Server-Authoritative Amount & Currency** | `/api/payments/initiate` computes `amountGross`, `currency`, and commission split strictly from PostgreSQL `bookings.agreedAmount`, `bookings.currency`, and `countries.commissionRatePct` — client-submitted amounts are ignored | **Tested and passed** |
| **Commission Formula & Bounds (`8%–12%`)** | `calculateCommissionSplit()` clamps `ratePct` to `[8.00, 12.00]` and computes exact 2-decimal split (`commissionAmount + netToProfessional === amountGross`), stored in both `payments` and `commissions` (unique `paymentId`) | **Tested and passed** (`25000.00` XOF @ `10.00%` -> `2500.00` commission / `22500.00` net) |
| **Provider Enablement Gate** | Only providers in status `SANDBOX` or `VERIFIED_ACTIVE` for the booking's `countryId` can initiate payments; `DISABLED` / `UNVERIFIED` / unknown providers return `400` | **Tested and passed** |
| **Initiation Idempotency Key** | Unique constraint on `payments.idempotency_key`; duplicate calls return `200` with `idempotentReplay: true` and do not duplicate rows (also protected against concurrent race `23505`) | **Tested and passed** |
| **Raw-Body HMAC-SHA256 Signature** | `express.json({ verify })` captures unparsed `rawBody` UTF-8 bytes; verified with `crypto.timingSafeEqual` over `${timestamp}.${rawBody}` or `rawBody` | **Tested and passed** |
| **Timestamp Replay Window (`±300s`)** | Stale timestamps (`-600s`) rejected with `401`; missing `X-Kazi-Timestamp` rejected with `401` when `NODE_ENV === 'production'` | **Tested and passed** |
| **Delivery-ID Deduplication** | Duplicate `X-Kazi-Delivery-Id` webhooks return `200 { idempotentReplay: true }` without appending duplicate `payment_transactions` ledger rows | **Tested and passed** |
| **Amount & Currency Tampering Rejection** | `confirmPaymentServerSide()` aborts (`400`) inside `db.transaction` if webhook `amount` deviates `> 0.01` (`100` vs `25000`) or `currency` mismatches (`USD` vs `XOF`) | **Tested and passed** |
| **Terminal State Protection** | Once `CONFIRMED_SERVER`, late `FAILED` webhooks are rejected (`400`) and database state remains `CONFIRMED_SERVER`; `REFUNDED` payments cannot be re-confirmed | **Tested and passed** |
| **Atomic Refunds & Isolation** | `issueRefundServerSide()` performs atomic conditional update `WHERE status = 'CONFIRMED_SERVER'` returning `REFUNDED` payment + `APPROVED` refund record + `REFUND_ISSUED` transaction + `audit_logs`; double refund returns `400`; `LOCAL_ADMIN` outside country blocked (`403`) | **Tested and passed** |

---

## 2. Observed Country Payment Provider State (PostgreSQL)

Snapshot across `54 × 4 = 216` rows in `country_payment_providers`:

- **`VERIFIED_ACTIVE` (6 rows):** `bank_transfer` and `manual_cash` only in `CI`, `SN`, and `KM` (B2B invoicing / manual reconciliation workflows).
- **`SANDBOX` (6 rows):** `card_stripe` and `mobile_money` in `CI`, `SN`, and `KM` (sandbox/reconciliation testing only; `/api/payments/:id/sandbox-confirm` is blocked in production unless `ALLOW_SANDBOX_PAYMENTS=true`).
- **`UNVERIFIED` (153 rows):** Inactive/pending countries awaiting local PSP regulatory and aggregator onboarding.
- **`DISABLED` (51 rows):** `manual_cash` explicitly disabled outside active markets.

---

## 3. Production Blockers Before Real Money Collection (`Requires external validation`)

1. **No Live PSP Adapters Integrated (`BLOCKER` for live collection):** Stripe Connect/Checkout, Orange Money, Wave, MTN MoMo, and M-Pesa live API clients, per-provider signature headers (e.g., `Stripe-Signature`, Orange/Wave HMAC schemes), and payout settlement webhooks are **not yet wired**. Current `/api/payments/webhook` validates KAZI's unified internal HMAC-SHA256 contract.
2. **Webhook Replay Store Persistence (`MEDIUM`):** `webhookReplayCache` is process-local memory; a PostgreSQL `webhook_events(delivery_id PRIMARY KEY)` table is recommended before multi-instance production deployment.
3. **Currency Zero-Decimal Rules (`LOW`):** Local currencies such as `XOF`, `XAF`, `KMF`, `GNF` are currently formatted and stored with 2-decimal precision (`numeric(12, 2)`). Live PSP adapters must enforce each provider's minor-unit conversion rules (e.g., XOF zero-decimal vs Stripe cents) before transmitting live charges.
