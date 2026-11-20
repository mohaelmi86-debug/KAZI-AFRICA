# KAZI PROTECT API contract — implementation checklist
Base path: /api/protect

Authenticated server-side authorization is required unless explicitly stated public. Country scope is derived from the persisted protected object and checked against actor roles. A client-supplied country code never grants access.

## Customer
- GET /catalog?countryIso2=XX&objectType=WORK — only ACTIVE products with all release gates satisfied.
- POST /certificates/verify — opaque token; return minimal status, issuer type, dates and product label only.
- GET /me/certificates — current user's certificates.
- POST /claims — idempotent claim intake; validate ownership, eligibility and evidence limits.
- GET /claims/:id — claimant, assigned partner or authorized admin only.

## Professional / business
- GET /professional/eligibility?countryIso2=XX — required documents and eligible warranty options.
- POST /handover — checklist, evidence references, acceptance and reservations.
- GET /professional/certificates — own warranties and linked records.

## Country / platform administration
- GET /admin/countries/:iso2/settings
- PATCH /admin/countries/:iso2/settings — scoped compliance admin, versioned update and audit event.
- POST /admin/countries/:iso2/release-check — return blockers; never auto-activate.
- POST /admin/countries/:iso2/activate-product/:productCode — reject unless legal evidence, partner and UAT gates pass.
- POST /admin/partners and PATCH /admin/partners/:id — due diligence, authorization evidence and territory management.
- POST /webhooks/partners/:partnerCode/claims — signed, timestamped, replay-protected and idempotent.

## Mandatory invariants
1. Insurance policy/certificate requires issuer INSURER, verified partner, external policy reference and active country/product approval.
2. KAZI warranty certificates are labelled contractual and never imply insurer underwriting.
3. Only insurer/authorized partner decisions determine insurance coverage and indemnification.
4. Claim transitions are server-side, role-checked and audit-logged.
5. AI cannot generate premiums, limits, coverage promises or legal wording.
6. A product is not visible if country or product is not ACTIVE.
7. Writes use transaction boundaries and idempotency for external events.
8. Activation is blocked when any applicable gate is false or evidence expired.
9. Public verification is privacy-minimal and rate-limited.
10. Documents use private storage and short-lived signed access.

## Not yet implemented
Route handlers, UI, row-level authorization, storage integration, partner webhook adapters, migration execution and automated tests remain engineering work. Do not sell or activate products until completed and reviewed.
