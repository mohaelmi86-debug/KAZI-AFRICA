# KAZI AFRICA — Authentication, registration and onboarding specification

## Decision
KAZI AFRICA must support two authentication methods on the same Firebase Authentication identity:
1. Email + password (required primary alternative to Google).
2. Google sign-in (keep the existing option).

Do not build a parallel password table, custom password API, or second identity provider. Firebase Authentication remains the identity provider. The Express API remains authoritative for KAZI profiles, roles, organizations, country access and métier permissions.

## User journeys

### Create an account with email
- Fields: full name, email, password, confirm password, country, preferred language, account intention, acceptance of Terms and Privacy Policy.
- Account intention options: Client; Professional / artisan / independent worker; Company / organization; Training partner.
- Password requirements: minimum 12 characters; allow password managers and paste; never impose arbitrary composition rules; show/hide password; provide strength feedback.
- Create the Firebase account with createUserWithEmailAndPassword.
- Set the Firebase display name with updateProfile.
- Send verification with sendEmailVerification.
- Do not mark the email as verified in the app based on a frontend flag. Trust only the Firebase ID token's email_verified claim on the server.
- Explain that the user must verify the address, and provide resend-verification and refresh-status actions.
- After verification, obtain a fresh ID token (getIdToken(true)) and call the existing authenticated API to provision/load the KAZI profile.
- Do not create a second KAZI profile when the same Firebase UID signs in with Google later.

### Sign in with email
- Use signInWithEmailAndPassword.
- If email is not verified, show a clear verification-required screen with resend email and sign-out actions. Do not pretend the user is verified.
- If verified, refresh the ID token and load /api/auth/me.
- Preserve the existing Google sign-in flow as an alternative.

### Password recovery and change
- Add “Mot de passe oublié ?” using sendPasswordResetEmail.
- Add password change while authenticated using Firebase updatePassword, with recent-login reauthentication when Firebase requires it.
- Never send, store, log or expose raw passwords to the Express API or application database.
- Do not implement a custom password-reset token system.

### Link Google and email identities
- If a user is signed in with one provider and wants to add another, use Firebase linkWithPopup / linkWithCredential safely.
- If Firebase reports auth/account-exists-with-different-credential, guide the user through signing into the existing account and linking providers; do not silently create duplicate profiles.
- Never merge two KAZI profiles based only on matching email text. Use Firebase's provider-linking and UID continuity.

## Account type and métiers — separate from authentication
Authentication proves identity; it does not grant métier permissions.
- Every new self-registration starts with the least-privilege CLIENT role.
- The account-intention choice is onboarding metadata, not a trusted role assignment.
- A person who wants to work as a professional completes a professional application: métier/category, skills, service area, description, contact details and required supporting documents. Professional privileges are granted only by the server's controlled workflow after required checks/approval.
- A company user completes organization onboarding: legal name, country, sector and registration details. Organization ownership/admin access is created only by a server-side organization workflow with audit trail.
- Training partners and all administrative roles require invitation, verification or explicit administrator approval. Never allow a public signup form to request LOCAL_ADMIN, SUPER_ADMIN or other privileged roles.
- One Firebase identity may hold multiple legitimately granted KAZI roles. The user can switch only between roles already returned by /api/auth/me.
- Do not hard-code a short list of trades in the registration form. Load active service categories and skills from the existing API; allow the user to select the closest category and submit a “not listed” suggestion for moderation.

## Existing API integration
- Use existing Firebase client setup from src/lib/firebase.ts.
- Use existing apiFetch from src/services/api.ts, which sends the Firebase ID token.
- Use GET /api/auth/me after authentication and POST /api/auth/active-role only for roles already granted.
- Use existing country and category reference APIs; do not duplicate country or métier lists in the frontend.
- Do not add public profile creation or role-grant endpoints from the browser.
- The backend currently auto-provisions a minimal profile on first authenticated API request. Preserve UID idempotency and update that flow carefully if onboarding metadata is added.

## Backend security requirements (implementation work, not UI-only)
1. Enforce email verification from the verified Firebase ID token claim for protected account actions and all trust-sensitive workflows. Return 403 EMAIL_VERIFICATION_REQUIRED with a clear machine-readable code. Keep only the minimum public discovery endpoints accessible without authentication.
2. Ensure a new Firebase UID receives only CLIENT by default. Keep bootstrap super-admin provisioning server-side and remove any client-controlled role assignment path.
3. Add a server-controlled professional application/review lifecycle. A submitted application must not immediately create an approved professional identity or verified skills.
4. Add a server-controlled organization onboarding lifecycle. A submitted company form must not automatically grant enterprise admin permissions.
5. Add rate limiting and abuse controls around signup-related operations; rely on Firebase's email verification and account protections. Do not reveal whether an email address already exists on password-reset screens.
6. Add audit events for professional approval, organization creation/ownership, role grants/revocations and account suspension.
7. Ensure deletion/closure and data-export flows are designed for applicable privacy obligations; do not claim compliance until implemented and reviewed.
8. Add automated tests for verified/unverified tokens, duplicate provisioning, UID/provider linking, least-privilege role assignment, professional application approval, organization onboarding and suspended accounts.

## Frontend screens required
- Registration: email/password and Google choices; account intention; country/language; terms/privacy acceptance.
- Login: email/password and Google choices; forgot-password link.
- Verify email: pending state, resend, refresh status, change email/sign out.
- Forgot password: neutral success message that does not disclose account existence.
- Password reset completion: Firebase-managed secure flow.
- Account onboarding: client, professional, company, training partner pathways with distinct forms.
- Professional profile: métier/category, skills, location/service area, profile completion and document verification status.
- Organization profile: legal identity and team invitation after server-side creation.
- Account settings: linked sign-in methods, change password, sign out all sessions where supported, profile and privacy controls.

## Acceptance criteria
- A user without Google can register, verify email, sign in, sign out and recover access.
- Google sign-in continues to work.
- Google and email sign-in can resolve to the same Firebase UID after safe provider linking.
- A newly registered user cannot self-assign professional, enterprise or administrative privileges.
- A user in any supported country can choose an active métier/category from the API; the form is not limited to a few hard-coded trades.
- Professional and company onboarding are persisted through authorized backend workflows and reviewed where required.
- API endpoints enforce email verification and authorization server-side; hiding a frontend button is never considered security.
- Passwords never enter KAZI application tables, logs or API request bodies.