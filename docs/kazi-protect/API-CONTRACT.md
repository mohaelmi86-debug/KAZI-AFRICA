# KAZI PROTECT API contract and implementation status
Base path: /api/protect

All country-admin endpoints enforce server-side role and country scope. A country code supplied by a client never grants access. Insurance decisions remain with the authorized insurer.

## Implemented in this branch
- GET /catalog?countryIso2=XX — public catalogue; returns only products where country and product are ACTIVE and all release gates are true.
- GET /me/certificates — authenticated user's own certificates.
- POST /certificates/verify — public privacy-minimal opaque-token verification.
- POST /claims — authenticated certificate-owner claim intake with idempotency key and evidence limits.
- GET /claims/:id — claimant or authorized country administrator access.
- GET /admin/countries/:iso2/claims — country-scoped claims queue.
- POST /admin/claims/:id/transition — audited, role-checked workflow transitions; insurance coverage outcomes are blocked and remain insurer decisions.
- GET /admin/countries/:iso2/settings — country-scoped compliance settings.
- PATCH /admin/countries/:iso2/settings — allowlisted configuration changes with audit events; only SUPER_ADMIN can mark a legal review APPROVED, with evidence and reviewer organization.
- GET /admin/countries/:iso2/release-check — diagnostic blockers only; no automatic activation.
- POST /admin/countries/:iso2/activate — explicit country activation after every release gate and central legal approval.
- GET /admin/countries/:iso2/products — country product inventory.
- POST /admin/countries/:iso2/approve-product/:productCode — explicit product approval with evidence and wording versions.
- POST /admin/countries/:iso2/activate-product/:productCode — activation only after country/product gates and partner verification.
- GET /admin/countries/:iso2/partners and POST /admin/countries/:iso2/partners — scoped partner register; new partners are pending.
- POST /admin/partners/:id/verify — SUPER_ADMIN-only authorization verification with evidence reference.\n- PATCH /admin/countries/:iso2/products/:productCode/warranty-config — SUPER_ADMIN-only approved duration, scope and exclusions for an already approved warranty product.\n- POST /bookings/:bookingId/handover — assigned professional submits the checklist, work summary and before/after evidence references.\n- GET /bookings/:bookingId/handover — booking participants and country administrators retrieve the handover.\n- POST /handovers/:handoverId/respond — only the client accepts or records reservations.\n- POST /bookings/:bookingId/issue-warranty — assigned professional or country administrator may issue one contractual certificate only after accepted handover, client-validated completion and country/product release gates.

## Planned / not yet implemented
- POST /handover and professional eligibility endpoints.
- Certificate revocation workflow and QR/PDF generation (issuance API is implemented; revocation and document rendering remain pending).
- Partner webhook-driven insurance status synchronization and assignment automation.
- Partner webhooks (signature, timestamp, replay protection, idempotency).
- Private evidence-document storage, retention and signed URL access.
- Dedicated partner portal and claims administration UI.
- Formal RLS/database role isolation and automated integration/security tests.

## Mandatory invariants
1. Insurance policy/certificate requires issuer INSURER, verified partner, external policy reference and active country/product approval.
2. KAZI warranty certificates are labelled contractual and never imply insurer underwriting.
3. Only insurer/authorized partner decisions determine insurance coverage and indemnification.
4. Claim transitions are server-side, role-checked and audit-logged.
5. AI cannot generate premiums, limits, coverage promises or legal wording.
6. A product is not visible if country or product is not ACTIVE.
7. Writes use transaction boundaries and idempotency for external events.
8. Activation is blocked when any applicable gate is false or evidence is missing/expired.
9. Public verification is privacy-minimal and rate-limited.
10. Documents use private storage and short-lived signed access.

## Release boundary
The migrations are additive but have not been executed against any database in this task. Warranty issuance also remains unavailable until an approved warranty product has a centrally configured duration, scope, exclusions, terms and disclosure versions. Do not enable or sell products until migrations, UI, storage, security tests, partner due diligence and country legal reviews are complete.
