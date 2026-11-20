# Google AI Studio — KAZI PROTECT frontend integration brief

## Authentication and account onboarding — mandatory frontend scope

This is part of the same frontend delivery. Do not leave the existing Google-only authentication as the sole registration path.

- Implement email/password registration and sign-in alongside the existing Google button, using the current Firebase Auth instance.
- Implement email verification, resend verification, password reset, and password change with Firebase Auth SDK methods. Never send passwords to the Express API or store them in the KAZI database.
- Add distinct onboarding paths for Client, Professional / artisan / independent worker, Company / organization, and Training partner.
- The selected account intention is not a role grant. New self-registered accounts receive only CLIENT. Professional, enterprise, training-partner and administrative privileges must be granted by backend-controlled workflows after required checks or approval.
- Load country, service category and skill choices from existing APIs. Do not hard-code a short métier list; include a “not listed” suggestion path.
- Preserve one Firebase UID and one KAZI profile when users link Google and email sign-in. Use Firebase provider linking; never merge accounts on matching email alone.
- Enforce verified email using the server-verified Firebase ID token claim. The frontend verification screen is UX only and cannot authorize protected actions.
- Full requirements and acceptance criteria: docs/kazi-protect/AUTHENTICATION-REGISTRATION-ONBOARDING.md

## Purpose
Build the KAZI PROTECT user interface inside the existing KAZI AFRICA frontend. Do not create a second backend, database, authentication system, or parallel business-rules engine. The existing Express API is authoritative.

API base path: `/api/protect`

## Non-negotiable integration rules
1. Reuse the project's existing Firebase authentication and API client. Send the Firebase ID token as `Authorization: Bearer <token>`.
2. Never write directly to the database or bypass the Express API.
3. Never decide country/product eligibility, warranty duration, certificate status, claim outcome, insurer coverage, or user permissions in the browser.
4. Treat the API response as authoritative. Hide actions for usability, but always expect server-side 401/403/409 responses.
5. Never store a raw verification token in browser storage, logs, analytics, or URLs other than the QR/verification link the user explicitly saves or shares.
6. Evidence references are not public URLs. Do not render them as clickable links unless the existing secure document service returns an authorized short-lived URL.
7. Do not invent warranty terms, exclusions, legal wording, insurance promises, or product availability.
8. Do not mark a booking completed when the client accepts the handover. The existing booking transition API remains responsible for final validation and payment lifecycle.
9. Keep insurance policy status partner-controlled. KAZI UI must not offer insurance claim acceptance/rejection or insurer policy revocation.

## Screens and workflows

### Professional — handover submission
- Add a handover panel to the assigned booking detail page.
- Display a checklist, work summary, before-evidence references and after-evidence references.
- Require every checklist item to be completed before submission.
- Require at least two evidence references in total, with both before and after evidence represented.
- Submit:
  `POST /api/protect/bookings/{bookingId}/handover`
- Body:
  ```json
  {
    "checklist": [
      { "item": "Travaux réalisés conformément au devis", "completed": true, "note": "" }
    ],
    "beforeEvidenceRefs": ["private-object-ref-before"],
    "afterEvidenceRefs": ["private-object-ref-after"],
    "workSummary": "Résumé factuel de la prestation réalisée."
  }
  ```
- If evidence upload is not already supported by a secure private storage module, show the evidence area as unavailable/coming soon; do not substitute public image URLs.

### Client — review handover
- Fetch:
  `GET /api/protect/bookings/{bookingId}/handover`
- Show the work summary, checklist and authorized evidence previews.
- Offer exactly two responses:
  - Accept: `POST /api/protect/handovers/{handoverId}/respond` with `{"decision":"ACCEPT","reservations":[],"responseNote":"..." }`
  - Record reservations: same endpoint with `{"decision":"RESERVE","reservations":["..."],"responseNote":"..." }`
- Reservations block final booking completion until the professional corrects and resubmits the handover and the client accepts.
- A client response never itself changes booking status or releases payment.

### Booking completion
- Use the existing booking transition flow.
- If a handover exists, the backend requires status ACCEPTED before transition to COMPLETED.
- Surface the backend conflict message clearly; never bypass it.

### Client — certificates
- Fetch:
  `GET /api/protect/me/certificates`
- Display certificate number, country, protection kind, issuer, dates and status.
- Do not expose verification hashes or internal IDs as public identifiers.

### Professional/admin — issue a warranty
- The booking must already be COMPLETED and have a client validation timestamp.
- An ACCEPTED handover must exist.
- Submit:
  `POST /api/protect/bookings/{bookingId}/issue-warranty`
- Body:
  `{"productCode":"WORKMANSHIP_GUARANTEE"}`
- The backend returns the certificate and a one-time `verificationToken` only on first issuance.
- Display the token once with an explicit copy/save warning. Do not expect it to be retrievable on later calls.
- Generate a QR code in the frontend that encodes the public verification URL configured for this deployment, passing the opaque token to the verification screen. Do not invent the production domain.

### Public certificate verification
- Send:
  `POST /api/protect/certificates/verify`
- Body:
  `{"token":"<opaque-token>"}`
- Display only the API's privacy-minimal result: valid/invalid, certificate number, country, protection kind, issuer and dates.
- Never display customer names, phone numbers, addresses, claim notes or evidence references.

### Country administration — warranty configuration
- SUPER_ADMIN only:
  `PATCH /api/protect/admin/countries/{iso2}/products/{productCode}/warranty-config`
- Body:
  ```json
  {
    "warrantyDurationDays": 90,
    "approvalEvidenceRef": "private-legal-approval-reference",
    "coverageSummary": "Approved contractual scope summary.",
    "exclusions": ["Approved exclusion"]
  }
  ```
- Do not prefill 90 days or any other default in production. The example is illustrative only. Require the administrator to enter the approved values from the legal approval record.
- Only offer this form for a warranty product already approved with terms and disclosure versions.

### Country administration — revoke warranty
- `POST /api/protect/admin/certificates/{certificateId}/revoke`
- Body: `{"reason":"Motif documenté de révocation.","evidenceRef":"private-evidence-reference"}`
- Only KAZI contractual warranties can be revoked here. Insurance policies must be handled by the issuing insurer/authorized partner.

## Error and loading behavior
- 401: route to the existing sign-in flow.
- 403: show a permission/scope message; do not retry with another role automatically.
- 404: show not found or no access, without leaking whether a private resource exists.
- 409: show the backend conflict and the action needed (handover not accepted, booking not validated, product inactive, terms not configured, etc.).
- 429: respect Retry-After and offer a retry.
- 503: show temporary service unavailability and preserve unsent form input.
- Use loading, empty, success and error states. Disable duplicate submissions while a request is pending.

## UI quality requirements
- Keep the existing KAZI AFRICA design system, navigation and responsive conventions.
- Do not duplicate navigation tabs or create a second dashboard.
- Provide French first, with existing English/Arabic/Portuguese localization patterns.
- Use accessible labels, keyboard focus, clear status badges and confirmation dialogs for irreversible actions.
- Show the distinction between CONTRACTUAL_WARRANTY and INSURER_POLICY prominently.

## Backend gaps — do not fake these in the frontend
- Private evidence storage, upload scanning, retention and short-lived signed URL delivery.
- QR/PDF certificate document generation and a configured public verification URL.
- Notifications for submitted handovers, client reservations and accepted handovers.
- Partner webhook integration for insurer policy lifecycle.
- Automated end-to-end tests and successful CI run evidence.

## Definition of done
- All calls use the existing API and Firebase identity.
- A professional can submit a complete evidence-backed handover.
- The client can accept or record reservations.
- A handover with reservations cannot be used to complete the booking.
- A booking with a handover cannot transition to COMPLETED until it is ACCEPTED.
- A warranty cannot be issued until handover acceptance, client validation, country/product activation and centrally approved terms/configuration are all satisfied.
- A certificate verification QR calls the public verification API and reveals only minimal fields.
- No frontend-only legal or authorization decision exists.
