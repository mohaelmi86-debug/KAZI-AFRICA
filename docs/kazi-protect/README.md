# KAZI PROTECT GLOBAL
Version 0.1.0 — architecture foundation. Status: not production-enabled.

## Objective
One reusable protection platform for every KAZI AFRICA deployment. The software core is shared; legal eligibility, product availability, insurance distribution, limits, taxes, languages, currencies, providers and disclosures are configured per country.

A country in the registry is NOT automatically approved for insurance distribution. Every insurance product stays unavailable until local legal review and an authorized insurer/intermediary partnership are evidenced and approved.

## Product domains
1. Warranty: contractual service/product warranties, eligibility, duration, exclusions, evidence and remedy workflow.
2. Insurance distribution: partner-issued products only. KAZI must not underwrite, bind, price or adjudicate insurance unless separately authorized.
3. Quality & handover: checklists, before/after evidence, acceptance, reservations and completion records.
4. Claims & complaints: intake, triage, evidence, assignment, partner referral and status tracking. Insurance coverage decisions remain with the insurer.
5. Certificates: distinguish KAZI contractual warranty records from insurer-issued policy/certificates.
6. Trust: professional credentials, qualifications and insurance evidence with expiry reminders.
7. Payment protection: provider-controlled authorization/escrow/release only where legally and contractually supported. No KAZI custody of client funds by default.

## Country deployment model
Each of the 54 African countries receives a configuration record from the same schema. Initial state is NOT_REVIEWED and disabled. Store legal review status, evidence references, product lines allowed/prohibited/pending, approved partners and territories, disclosures, currency, language, tax treatment, complaint channels and operational limits.

Never copy one country's legal rules into another. Regional memberships are context, not proof of insurance authorization.

## Global product taxonomy
SERVICE_WARRANTY, PRODUCT_WARRANTY, WORKMANSHIP_GUARANTEE, DELIVERY_PROTECTION, ACCIDENTAL_DAMAGE_INSURANCE, PROFESSIONAL_LIABILITY_INSURANCE, CONSTRUCTION_INSURANCE, HOME_INSURANCE, EQUIPMENT_BREAKDOWN_INSURANCE, QUALITY_INSPECTION.

The taxonomy is global; country eligibility is controlled separately.

## Country release gates
A country/product may activate only after:
1. Written legal/regulatory assessment for the specific product and KAZI's distribution role.
2. Partner authorization, license and territory verified from primary evidence.
3. Approved policy wording, exclusions, limits, premium/tax display and cancellation/refund flow.
4. Approved customer journey, pre-contract information, consent and durable-document delivery.
5. Claims/complaints escalation agreement and service levels.
6. Data protection, retention, cross-border transfer and security review.
7. Payment collection and settlement validated with an authorized provider.
8. Country UAT, operational owner and incident process signed off.

Missing evidence blocks activation. READY is never inferred.

## Security principles
- Country and tenant scoping on every read/write; server-side authorization.
- Never trust country, owner, amount, eligibility or claim status from the browser.
- Append-only audit events for material state changes.
- Idempotency for issuance, payment callbacks and claim intake.
- Private document storage, encryption and short-lived signed access.
- Opaque certificate verification tokens; public verification reveals minimal data.
- AI may assist triage and document completeness, but cannot approve/deny claims, determine coverage, set premiums or issue binding legal conclusions.

## Implementation boundary
This foundation adds a database migration, product catalogue, country configuration contract and API contract. It does not activate insurance products, create insurer partnerships, issue legally binding policies, or mark any country compliant. API handlers, authorization tests, migration execution and UI integration are required before production use.
