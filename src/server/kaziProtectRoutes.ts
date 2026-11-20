import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { optionalAuth, rateLimit, requireAnyRole, requireAuth, type AuthRequest } from '../middleware/auth.ts';

const protectReadLimit = rateLimit(60, 60_000);
const protectWriteLimit = rateLimit(15, 60_000);
const ISO2 = /^[A-Z]{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  return ((result as { rows?: T[] })?.rows || []);
}
function isCountryAdmin(ctx: NonNullable<AuthRequest['authCtx']>, iso2: string): boolean {
  return ctx.roles.includes('SUPER_ADMIN') || (ctx.roles.includes('LOCAL_ADMIN') && ctx.adminCountryIso2s.includes(iso2));
}
function requireCountryAdmin(req: AuthRequest, res: Response, iso2: string): boolean {
  if (!req.authCtx) { res.status(401).json({ error: 'Authentication required' }); return false; }
  if (!isCountryAdmin(req.authCtx, iso2)) { res.status(403).json({ error: 'Country scope not authorized' }); return false; }
  return true;
}
function validIso2(value: unknown): value is string {
  return typeof value === 'string' && ISO2.test(value);
}
function parseJsonArray(value: unknown, max = 10): string[] | null {
  if (!Array.isArray(value) || value.length > max || value.some((v) => typeof v !== 'string' || v.length > 500)) return null;
  return value as string[];
}

export function registerKaziProtectRoutes(app: Express): void {
  // Public catalogue: never reveal products outside an explicitly ACTIVE country/product.
  app.get('/api/protect/catalog', protectReadLimit, optionalAuth, async (req, res) => {
    try {
      const iso2 = String(req.query.countryIso2 || '').toUpperCase();
      if (!validIso2(iso2)) return res.status(400).json({ error: 'A valid countryIso2 is required' });
      const result = await db.execute(sql`
        SELECT p.product_code AS "productCode", p.name, p.category, p.description,
               cp.terms_version AS "termsVersion", cp.disclosure_version AS "disclosureVersion",
               s.currency_code AS currency
        FROM kazi_protect_country_settings s
        JOIN kazi_protect_country_products cp ON cp.country_iso2 = s.country_iso2
        JOIN kazi_protect_products p ON p.id = cp.product_id
        WHERE s.country_iso2 = ${iso2}
          AND s.status = 'ACTIVE'
          AND s.regulatory_review_status = 'APPROVED'
          AND cp.status = 'ACTIVE'
          AND (s.release_gates->>'legalReview')::boolean IS TRUE
          AND (s.release_gates->>'partnerVerified')::boolean IS TRUE
          AND (s.release_gates->>'wordingApproved')::boolean IS TRUE
          AND (s.release_gates->>'claimsProcessReady')::boolean IS TRUE
          AND (s.release_gates->>'privacyReview')::boolean IS TRUE
          AND (s.release_gates->>'paymentFlowVerified')::boolean IS TRUE
          AND (s.release_gates->>'countryUatPassed')::boolean IS TRUE
        ORDER BY p.category, p.name
      `);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ countryIso2: iso2, products: rowsOf(result) });
    } catch (error) {
      console.error('KAZI PROTECT catalogue error:', error);
      return res.status(503).json({ error: 'Protection catalogue temporarily unavailable' });
    }
  });

  // Customer's own certificates only.
  app.get('/api/protect/me/certificates', requireAuth, protectReadLimit, async (req: AuthRequest, res) => {
    try {
      const result = await db.execute(sql`
        SELECT id, certificate_number AS "certificateNumber", country_iso2 AS "countryIso2",
               protected_object_type AS "protectedObjectType", protection_kind AS "protectionKind",
               issuer_type AS "issuerType", starts_at AS "startsAt", ends_at AS "endsAt",
               status, issued_at AS "issuedAt"
        FROM kazi_protect_certificates
        WHERE owner_profile_id = ${req.authCtx!.profileId}
        ORDER BY created_at DESC LIMIT 100
      `);
      return res.json({ certificates: rowsOf(result) });
    } catch (error) {
      console.error('KAZI PROTECT certificates error:', error);
      return res.status(503).json({ error: 'Certificates temporarily unavailable' });
    }
  });

  // Privacy-minimal public verification. The raw token is never stored.
  app.post('/api/protect/certificates/verify', protectReadLimit, async (req, res) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      if (token.length < 32 || token.length > 256) return res.status(400).json({ error: 'Invalid verification token' });
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const result = await db.execute(sql`
        SELECT c.certificate_number AS "certificateNumber", c.country_iso2 AS "countryIso2",
               c.protection_kind AS "protectionKind", c.issuer_type AS "issuerType",
               c.starts_at AS "startsAt", c.ends_at AS "endsAt", c.status,
               c.id AS "certificateId"
        FROM kazi_protect_certificates c
                WHERE c.verification_token_hash = ${tokenHash}
        LIMIT 1
      `);
      const cert = rowsOf(result)[0];
      if (!cert) return res.status(404).json({ valid: false });
      const now = Date.now();
      const active = cert.status === 'ACTIVE' && (!cert.startsAt || new Date(String(cert.startsAt)).getTime() <= now) &&
        (!cert.endsAt || new Date(String(cert.endsAt)).getTime() >= now);
      return res.json({ valid: active, certificateNumber: cert.certificateNumber, countryIso2: cert.countryIso2,
        protectionKind: cert.protectionKind, issuerType: cert.issuerType, startsAt: cert.startsAt, endsAt: cert.endsAt });
    } catch (error) {
      console.error('KAZI PROTECT certificate verification error:', error);
      return res.status(503).json({ error: 'Verification temporarily unavailable' });
    }
  });

  // Idempotent claim intake. Eligibility and ownership are verified on the server.
  app.post('/api/protect/claims', requireAuth, protectWriteLimit, async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const certificateId = String(req.body?.certificateId || '');
      const claimType = String(req.body?.claimType || '');
      const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
      const evidenceRefs = parseJsonArray(req.body?.evidenceRefs, 10);
      const idempotencyKey = String(req.headers['idempotency-key'] || '');
      const allowedTypes = ['WARRANTY_REPAIR','SERVICE_COMPLAINT','PRODUCT_DEFECT','DELIVERY_DAMAGE','INSURANCE_NOTICE','OTHER'];
      if (!UUID.test(certificateId) || !allowedTypes.includes(claimType) || description.length < 10 || description.length > 4000 ||
          !evidenceRefs || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return res.status(400).json({ error: 'Invalid claim payload or missing Idempotency-Key' });
      }
      const existing = await db.execute(sql`
        SELECT id, claim_number AS "claimNumber", status FROM kazi_protect_claims
        WHERE claimant_profile_id = ${ctx.profileId} AND idempotency_key = ${idempotencyKey} LIMIT 1
      `);
      const previous = rowsOf(existing)[0];
      if (previous) return res.status(200).json({ claim: previous, idempotentReplay: true });

      const certResult = await db.execute(sql`
        SELECT id, country_iso2 AS "countryIso2", owner_profile_id AS "ownerProfileId", status,
               protection_kind AS "protectionKind", ends_at AS "endsAt"
        FROM kazi_protect_certificates WHERE id = ${certificateId} LIMIT 1
      `);
      const cert = rowsOf(certResult)[0];
      if (!cert || cert.ownerProfileId !== ctx.profileId) {
        return res.status(404).json({ error: 'Eligible certificate not found' });
      }
      if (!['ACTIVE','ISSUED'].includes(String(cert.status)) ||
          (cert.endsAt && new Date(String(cert.endsAt)).getTime() < Date.now())) {
        return res.status(409).json({ error: 'Certificate is not currently eligible for a claim' });
      }
      const claimNumber = `KZP-${String(cert.countryIso2)}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const inserted = await db.execute(sql`
        INSERT INTO kazi_protect_claims
          (claim_number, country_iso2, certificate_id, claimant_profile_id, claim_type, description, evidence_refs, idempotency_key)
        VALUES (${claimNumber}, ${cert.countryIso2}, ${certificateId}, ${ctx.profileId}, ${claimType},
                ${description}, ${JSON.stringify(evidenceRefs)}::jsonb, ${idempotencyKey})
        ON CONFLICT (claimant_profile_id, idempotency_key) DO NOTHING
        RETURNING id, claim_number AS "claimNumber", status, submitted_at AS "submittedAt"
      `);
      let claim = rowsOf(inserted)[0];
      if (!claim) {
        const replay = await db.execute(sql`SELECT id, claim_number AS "claimNumber", status FROM kazi_protect_claims
          WHERE claimant_profile_id = ${ctx.profileId} AND idempotency_key = ${idempotencyKey} LIMIT 1`);
        claim = rowsOf(replay)[0];
      }
      await db.execute(sql`
        INSERT INTO kazi_protect_audit_events (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
        VALUES (${cert.countryIso2}, ${ctx.uid}, 'claim', ${claim.id}, 'CLAIM_SUBMITTED',
          ${JSON.stringify({ claimNumber, claimType })}::jsonb, ${req.requestId || null})
      `);
      return res.status(201).json({ claim });
    } catch (error) {
      console.error('KAZI PROTECT claim intake error:', error);
      return res.status(503).json({ error: 'Claim intake temporarily unavailable' });
    }
  });

  app.get('/api/protect/claims/:id', requireAuth, protectReadLimit, async (req: AuthRequest, res) => {
    try {
      const id = String(req.params.id);
      if (!UUID.test(id)) return res.status(400).json({ error: 'Invalid claim identifier' });
      const result = await db.execute(sql`
        SELECT id, claim_number AS "claimNumber", country_iso2 AS "countryIso2", certificate_id AS "certificateId",
          claimant_profile_id AS "claimantProfileId", claim_type AS "claimType", description, evidence_refs AS "evidenceRefs",
          status, assigned_partner_id AS "assignedPartnerId", insurer_decision_reference AS "insurerDecisionReference",
          resolution_summary AS "resolutionSummary", submitted_at AS "submittedAt", updated_at AS "updatedAt"
        FROM kazi_protect_claims WHERE id = ${id} LIMIT 1
      `);
      const claim = rowsOf(result)[0];
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
      if (claim.claimantProfileId !== req.authCtx!.profileId && !isCountryAdmin(req.authCtx!, String(claim.countryIso2))) {
        return res.status(403).json({ error: 'Claim access denied' });
      }
      return res.json({ claim });
    } catch (error) {
      console.error('KAZI PROTECT claim lookup error:', error);
      return res.status(503).json({ error: 'Claim temporarily unavailable' });
    }
  });

  // Country compliance settings: local admins can access only their assigned country.
  app.get('/api/protect/admin/countries/:iso2/settings', requireAuth, requireAnyRole(['SUPER_ADMIN','LOCAL_ADMIN']), async (req: AuthRequest, res) => {
    const iso2 = String(req.params.iso2 || '').toUpperCase();
    if (!validIso2(iso2)) return res.status(400).json({ error: 'Invalid country code' });
    if (!requireCountryAdmin(req, res, iso2)) return;
    try {
      const result = await db.execute(sql`
        SELECT country_iso2 AS "countryIso2", status, currency_code AS "currencyCode", languages,
          regulatory_review_status AS "regulatoryReviewStatus", regulatory_reviewed_at AS "regulatoryReviewedAt",
          reviewer_organization AS "reviewerOrganization", regulatory_evidence_refs AS "regulatoryEvidenceRefs",
          release_gates AS "releaseGates", config_version AS "configVersion", updated_at AS "updatedAt"
        FROM kazi_protect_country_settings WHERE country_iso2 = ${iso2} LIMIT 1
      `);
      const settings = rowsOf(result)[0];
      if (!settings) return res.status(404).json({ error: 'Country protection configuration not provisioned' });
      return res.json({ settings });
    } catch (error) {
      console.error('KAZI PROTECT country settings error:', error);
      return res.status(503).json({ error: 'Country settings temporarily unavailable' });
    }
  });

  app.patch('/api/protect/admin/countries/:iso2/settings', requireAuth, requireAnyRole(['SUPER_ADMIN','LOCAL_ADMIN']), protectWriteLimit, async (req: AuthRequest, res) => {
    const iso2 = String(req.params.iso2 || '').toUpperCase();
    if (!validIso2(iso2)) return res.status(400).json({ error: 'Invalid country code' });
    if (!requireCountryAdmin(req, res, iso2)) return;
    const body = req.body || {};
    const allowedKeys = ['currencyCode','languages','regulatoryReviewStatus','reviewerOrganization','regulatoryEvidenceRefs','releaseGates'];
    if (Object.keys(body).some((key) => !allowedKeys.includes(key))) return res.status(400).json({ error: 'Unsupported configuration field' });
    const review = body.regulatoryReviewStatus;
    if (review !== undefined && !['NOT_STARTED','IN_PROGRESS','APPROVED','REJECTED','EXPIRED'].includes(review)) {
      return res.status(400).json({ error: 'Invalid regulatory review status' });
    }
    if (review === 'APPROVED') {
      if (!req.authCtx!.roles.includes('SUPER_ADMIN')) return res.status(403).json({ error: 'Only central compliance administration can approve a country legal review' });
      if (!Array.isArray(body.regulatoryEvidenceRefs) || body.regulatoryEvidenceRefs.length === 0 ||
          typeof body.reviewerOrganization !== 'string' || !body.reviewerOrganization.trim()) {
        return res.status(400).json({ error: 'Approved legal review requires evidence references and reviewer organization' });
      }
    }
    const gates = body.releaseGates;
    const gateKeys = ['legalReview','partnerVerified','wordingApproved','claimsProcessReady','privacyReview','paymentFlowVerified','countryUatPassed'];
    if (gates !== undefined && (!gates || typeof gates !== 'object' || Array.isArray(gates) ||
        Object.keys(gates).some((k) => !gateKeys.includes(k)) || Object.values(gates).some((v) => typeof v !== 'boolean'))) {
      return res.status(400).json({ error: 'Invalid release gates' });
    }
    const languages = body.languages;
    if (languages !== undefined && (!Array.isArray(languages) || languages.length > 12 ||
        languages.some((v: unknown) => typeof v !== 'string' || v.length > 12))) {
      return res.status(400).json({ error: 'Invalid languages' });
    }
    if (body.currencyCode !== undefined && (typeof body.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(body.currencyCode))) {
      return res.status(400).json({ error: 'Invalid currency code' });
    }
    if (body.regulatoryEvidenceRefs !== undefined && (!Array.isArray(body.regulatoryEvidenceRefs) ||
        body.regulatoryEvidenceRefs.length > 30 || body.regulatoryEvidenceRefs.some((v: unknown) => typeof v !== 'string' || v.length > 500))) {
      return res.status(400).json({ error: 'Invalid evidence references' });
    }
    try {
      const result = await db.execute(sql`
        UPDATE kazi_protect_country_settings SET
          currency_code = COALESCE(${body.currencyCode ?? null}, currency_code),
          languages = COALESCE(${languages === undefined ? null : JSON.stringify(languages)}::jsonb, languages),
          regulatory_review_status = COALESCE(${review ?? null}, regulatory_review_status),
          reviewer_organization = COALESCE(${body.reviewerOrganization ?? null}, reviewer_organization),
          regulatory_evidence_refs = COALESCE(${body.regulatoryEvidenceRefs === undefined ? null : JSON.stringify(body.regulatoryEvidenceRefs)}::jsonb, regulatory_evidence_refs),
          release_gates = CASE WHEN ${gates === undefined} THEN release_gates ELSE release_gates || ${JSON.stringify(gates)}::jsonb END,
          config_version = config_version + 1, updated_at = now()
        WHERE country_iso2 = ${iso2}
        RETURNING country_iso2 AS "countryIso2", status, currency_code AS "currencyCode",
          regulatory_review_status AS "regulatoryReviewStatus", release_gates AS "releaseGates", config_version AS "configVersion"
      `);
      const settings = rowsOf(result)[0];
      if (!settings) return res.status(404).json({ error: 'Country configuration not found' });
      await db.execute(sql`
        INSERT INTO kazi_protect_audit_events (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
        SELECT ${iso2}, ${req.authCtx!.uid}, 'country_settings', gen_random_uuid(), 'COUNTRY_SETTINGS_UPDATED',
          ${JSON.stringify({ changedKeys: Object.keys(body), configVersion: settings.configVersion })}::jsonb, ${req.requestId || null}
      `);
      return res.json({ settings });
    } catch (error) {
      console.error('KAZI PROTECT country settings update error:', error);
      return res.status(503).json({ error: 'Country settings update failed' });
    }
  });

  // Readiness check is diagnostic only. It never changes activation state.
  app.post('/api/protect/admin/countries/:iso2/release-check', requireAuth, requireAnyRole(['SUPER_ADMIN','LOCAL_ADMIN']), async (req: AuthRequest, res) => {
    const iso2 = String(req.params.iso2 || '').toUpperCase();
    if (!validIso2(iso2)) return res.status(400).json({ error: 'Invalid country code' });
    if (!requireCountryAdmin(req, res, iso2)) return;
    try {
      const result = await db.execute(sql`
        SELECT status, regulatory_review_status AS "regulatoryReviewStatus", release_gates AS "releaseGates"
        FROM kazi_protect_country_settings WHERE country_iso2 = ${iso2} LIMIT 1
      `);
      const settings = rowsOf(result)[0];
      if (!settings) return res.status(404).json({ error: 'Country configuration not found' });
      const gates = settings.releaseGates as Record<string, boolean>;
      const blockers = Object.entries(gates || {}).filter(([, passed]) => passed !== true).map(([key]) => key);
      if (settings.regulatoryReviewStatus !== 'APPROVED') blockers.push('regulatoryReviewStatus');
      return res.json({ countryIso2: iso2, ready: blockers.length === 0, blockers, currentStatus: settings.status });
    } catch (error) {
      console.error('KAZI PROTECT release check error:', error);
      return res.status(503).json({ error: 'Release check temporarily unavailable' });
    }
  });

  // Country-scoped product inventory for the compliance console.
  app.get('/api/protect/admin/countries/:iso2/products', requireAuth, requireAnyRole(['SUPER_ADMIN','LOCAL_ADMIN']), protectReadLimit, async (req: AuthRequest, res) => {
    const iso2 = String(req.params.iso2 || '').toUpperCase();
    if (!validIso2(iso2)) return res.status(400).json({ error: 'Invalid country code' });
    if (!requireCountryAdmin(req, res, iso2)) return;
    try {
      const result = await db.execute(sql`
        SELECT p.product_code AS "productCode", p.name, p.category, p.requires_authorized_partner AS "requiresAuthorizedPartner",
          cp.status, cp.terms_version AS "termsVersion", cp.disclosure_version AS "disclosureVersion",
          cp.partner_ids AS "partnerIds", cp.local_config AS "localConfig", cp.approved_at AS "approvedAt"
        FROM kazi_protect_country_products cp
        JOIN kazi_protect_products p ON p.id = cp.product_id
        WHERE cp.country_iso2 = ${iso2} ORDER BY p.category, p.name
      `);
      return res.json({ countryIso2: iso2, products: rowsOf(result) });
    } catch (error) {
      console.error('KAZI PROTECT product inventory error:', error);
      return res.status(503).json({ error: 'Product inventory temporarily unavailable' });
    }
  });

  // Partner registration is pending by default. Only central compliance can mark authorization verified.
  app.get('/api/protect/admin/countries/:iso2/partners', requireAuth, requireAnyRole(['SUPER_ADMIN','LOCAL_ADMIN']), protectReadLimit, async (req: AuthRequest, res) => {
    const iso2 = String(req.params.iso2 || '').toUpperCase();
    if (!validIso2(iso2)) return res.status(400).json({ error: 'Invalid country code' });
    if (!requireCountryAdmin(req, res, iso2)) return;
    try {
      const result = await db.execute(sql`
        SELECT id, partner_type AS "partnerType", legal_name AS "legalName",
          registration_reference AS "registrationReference", authorization_reference AS "authorizationReference",
          authorization_verified_at AS "authorizationVerifiedAt", authorization_evidence_ref AS "authorizationEvidenceRef",
          territories, status, created_at AS "createdAt"
        FROM kazi_protect_partners WHERE country_iso2 = ${iso2} ORDER BY created_at DESC
      `);
      return res.json({ countryIso2: iso2, partners: rowsOf(result) });
    } catch (error) {
      console.error('KAZI PROTECT partner list error:', error);
      return res.status(503).json({ error: 'Partner list temporarily unavailable' });
    }
  });

  app.post('/api/protect/admin/countries/:iso2/partners', requireAuth, requireAnyRole(['SUPER_ADMIN','LOCAL_ADMIN']), protectWriteLimit, async (req: AuthRequest, res) => {
    const iso2 = String(req.params.iso2 || '').toUpperCase();
    if (!validIso2(iso2)) return res.status(400).json({ error: 'Invalid country code' });
    if (!requireCountryAdmin(req, res, iso2)) return;
    const body = req.body || {};
    const types = ['INSURER','BROKER','INTERMEDIARY','EXPERT','QUALITY_PROVIDER','PAYMENT_PROVIDER'];
    const legalName = typeof body.legalName === 'string' ? body.legalName.trim() : '';
    const registrationReference = typeof body.registrationReference === 'string' ? body.registrationReference.trim() : '';
    const authorizationReference = typeof body.authorizationReference === 'string' ? body.authorizationReference.trim() : '';
    const authorizationEvidenceRef = typeof body.authorizationEvidenceRef === 'string' ? body.authorizationEvidenceRef.trim() : '';
    const territories = parseJsonArray(body.territories || [iso2], 20);
    if (!types.includes(body.partnerType) || legalName.length < 2 || legalName.length > 200 ||
        registrationReference.length > 120 || authorizationReference.length > 160 ||
        authorizationEvidenceRef.length > 500 || !territories || territories.some((code) => !ISO2.test(code)) ||
        (!req.authCtx!.roles.includes('SUPER_ADMIN') && territories.some((code) => code !== iso2))) {
      return res.status(400).json({ error: 'Invalid partner registration details' });
    }
    try {
      const inserted = await db.execute(sql`
        INSERT INTO kazi_protect_partners
          (country_iso2, partner_type, legal_name, registration_reference, authorization_reference,
           authorization_evidence_ref, territories, status)
        VALUES (${iso2}, ${body.partnerType}, ${legalName}, ${registrationReference || null},
          ${authorizationReference || null}, ${authorizationEvidenceRef || null},
          ${JSON.stringify(territories)}::jsonb, 'PENDING_VERIFICATION')
        RETURNING id, partner_type AS "partnerType", legal_name AS "legalName", status, territories
      `);
      const partner = rowsOf(inserted)[0];
      await db.execute(sql`
        INSERT INTO kazi_protect_audit_events (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
        VALUES (${iso2}, ${req.authCtx!.uid}, 'partner', ${partner.id}, 'PARTNER_REGISTERED',
          ${JSON.stringify({ partnerType: body.partnerType, legalName })}::jsonb, ${req.requestId || null})
      `);
      return res.status(201).json({ partner });
    } catch (error) {
      console.error('KAZI PROTECT partner registration error:', error);
      return res.status(503).json({ error: 'Partner registration failed' });
    }
  });

  app.post('/api/protect/admin/partners/:id/verify', requireAuth, requireAnyRole(['SUPER_ADMIN']), protectWriteLimit, async (req: AuthRequest, res) => {
    const id = String(req.params.id || '');
    if (!UUID.test(id)) return res.status(400).json({ error: 'Invalid partner identifier' });
    const verificationEvidenceRef = typeof req.body?.verificationEvidenceRef === 'string' ? req.body.verificationEvidenceRef.trim() : '';
    if (verificationEvidenceRef.length < 5 || verificationEvidenceRef.length > 500) {
      return res.status(400).json({ error: 'Primary-source authorization evidence reference is required' });
    }
    try {
      const result = await db.execute(sql`
        UPDATE kazi_protect_partners SET status = 'VERIFIED',
          authorization_verified_at = now(), authorization_evidence_ref = ${verificationEvidenceRef}, updated_at = now()
        WHERE id = ${id} AND status = 'PENDING_VERIFICATION'
          AND partner_type IN ('INSURER','BROKER','INTERMEDIARY')
          AND authorization_reference IS NOT NULL
        RETURNING id, country_iso2 AS "countryIso2", partner_type AS "partnerType",
          legal_name AS "legalName", status, territories
      `);
      const partner = rowsOf(result)[0];
      if (!partner) return res.status(409).json({ error: 'Partner is not eligible for verification or is not pending' });
      await db.execute(sql`
        INSERT INTO kazi_protect_audit_events (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
        VALUES (${partner.countryIso2}, ${req.authCtx!.uid}, 'partner', ${partner.id}, 'PARTNER_AUTHORIZATION_VERIFIED',
          ${JSON.stringify({ verificationEvidenceRef })}::jsonb, ${req.requestId || null})
      `);
      return res.json({ partner });
    } catch (error) {
      console.error('KAZI PROTECT partner verification error:', error);
      return res.status(503).json({ error: 'Partner verification failed' });
    }
  });

  // Country activation is a distinct gate; no product is activated implicitly.
  app.post('/api/protect/admin/countries/:iso2/activate', requireAuth, requireAnyRole(['SUPER_ADMIN','LOCAL_ADMIN']), protectWriteLimit, async (req: AuthRequest, res) => {
    const iso2 = String(req.params.iso2 || '').toUpperCase();
    if (!validIso2(iso2)) return res.status(400).json({ error: 'Invalid country code' });
    if (!requireCountryAdmin(req, res, iso2)) return;
    try {
      const check = await db.execute(sql`
        SELECT regulatory_review_status, release_gates FROM kazi_protect_country_settings
        WHERE country_iso2 = ${iso2} LIMIT 1
      `);
      const settings = rowsOf(check)[0];
      if (!settings) return res.status(404).json({ error: 'Country configuration not found' });
      const gates = settings.release_gates as Record<string, boolean>;
      const blockers = Object.entries(gates || {}).filter(([, passed]) => passed !== true).map(([key]) => key);
      if (settings.regulatory_review_status !== 'APPROVED') blockers.push('regulatoryReviewStatus');
      if (blockers.length) return res.status(409).json({ error: 'Country activation blocked', blockers });
      const result = await db.execute(sql`
        UPDATE kazi_protect_country_settings SET status = 'ACTIVE', updated_at = now(),
          config_version = config_version + 1
        WHERE country_iso2 = ${iso2} AND status IN ('READY','TESTING','CONFIGURING','NOT_REVIEWED','IN_REVIEW')
        RETURNING country_iso2 AS "countryIso2", status, config_version AS "configVersion"
      `);
      const activated = rowsOf(result)[0];
      if (!activated) return res.status(409).json({ error: 'Country is not in an activatable state' });
      await db.execute(sql`
        INSERT INTO kazi_protect_audit_events (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
        VALUES (${iso2}, ${req.authCtx!.uid}, 'country_settings', gen_random_uuid(), 'COUNTRY_ACTIVATED',
          ${JSON.stringify({ status: activated.status })}::jsonb, ${req.requestId || null})
      `);
      return res.json({ settings: activated });
    } catch (error) {
      console.error('KAZI PROTECT country activation error:', error);
      return res.status(503).json({ error: 'Country activation failed' });
    }
  });

  // Explicit approval is separate from activation. Evidence and customer-facing wording are mandatory.
  app.post('/api/protect/admin/countries/:iso2/approve-product/:productCode', requireAuth, requireAnyRole(['SUPER_ADMIN','LOCAL_ADMIN']), protectWriteLimit, async (req: AuthRequest, res) => {
    const iso2 = String(req.params.iso2 || '').toUpperCase();
    const code = String(req.params.productCode || '');
    const evidenceRef = typeof req.body?.approvalEvidenceRef === 'string' ? req.body.approvalEvidenceRef.trim() : '';
    const termsVersion = typeof req.body?.termsVersion === 'string' ? req.body.termsVersion.trim() : '';
    const disclosureVersion = typeof req.body?.disclosureVersion === 'string' ? req.body.disclosureVersion.trim() : '';
    if (!validIso2(iso2) || !/^[A-Z0-9_]{3,64}$/.test(code)) return res.status(400).json({ error: 'Invalid country or product code' });
    if (!requireCountryAdmin(req, res, iso2)) return;
    if (evidenceRef.length < 5 || evidenceRef.length > 500 || !termsVersion || !disclosureVersion) {
      return res.status(400).json({ error: 'Approval evidence, terms version and disclosure version are required' });
    }
    try {
      const readiness = await db.execute(sql`
        SELECT s.status AS country_status, s.regulatory_review_status, s.release_gates, p.id AS product_id,
               p.requires_authorized_partner
        FROM kazi_protect_country_settings s
        JOIN kazi_protect_products p ON p.product_code = ${code}
        WHERE s.country_iso2 = ${iso2} LIMIT 1
      `);
      const config = rowsOf(readiness)[0];
      if (!config) return res.status(404).json({ error: 'Country or product not found' });
      const gates = config.release_gates as Record<string, boolean>;
      const blockers = Object.entries(gates || {}).filter(([, passed]) => passed !== true).map(([key]) => key);
      if (config.country_status !== 'ACTIVE') blockers.push('countryNotActive');
      if (config.regulatory_review_status !== 'APPROVED') blockers.push('regulatoryReviewStatus');
      if (config.requires_authorized_partner) {
        const partners = await db.execute(sql`
          SELECT count(*)::int AS count FROM kazi_protect_partners
          WHERE country_iso2 = ${iso2} AND status = 'VERIFIED'
            AND partner_type IN ('INSURER','BROKER','INTERMEDIARY')
            AND territories @> ${JSON.stringify([iso2])}::jsonb
        `);
        if (Number(rowsOf(partners)[0]?.count || 0) < 1) blockers.push('verifiedAuthorizedPartner');
      }
      if (blockers.length) return res.status(409).json({ error: 'Product approval blocked', blockers });
      const approved = await db.execute(sql`
        UPDATE kazi_protect_country_products SET status = 'APPROVED',
          terms_version = ${termsVersion}, disclosure_version = ${disclosureVersion},
          local_config = local_config || ${JSON.stringify({ approvalEvidenceRef: evidenceRef })}::jsonb,
          approved_by = ${req.authCtx!.uid}, approved_at = now(), updated_at = now()
        WHERE country_iso2 = ${iso2} AND product_id = ${config.product_id}
          AND status IN ('DISABLED','PENDING_REVIEW','APPROVED')
        RETURNING id, status, terms_version AS "termsVersion", disclosure_version AS "disclosureVersion"
      `);
      const product = rowsOf(approved)[0];
      if (!product) return res.status(409).json({ error: 'Country product row not provisioned or cannot be approved' });
      await db.execute(sql`
        INSERT INTO kazi_protect_audit_events (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
        VALUES (${iso2}, ${req.authCtx!.uid}, 'country_product', ${product.id}, 'COUNTRY_PRODUCT_APPROVED',
          ${JSON.stringify({ productCode: code, evidenceRef, termsVersion, disclosureVersion })}::jsonb, ${req.requestId || null})
      `);
      return res.json({ countryIso2: iso2, productCode: code, product });
    } catch (error) {
      console.error('KAZI PROTECT product approval error:', error);
      return res.status(503).json({ error: 'Product approval failed' });
    }
  });

  // Product activation is a guarded administrative action; partner-backed products require verified territory coverage.
  app.post('/api/protect/admin/countries/:iso2/activate-product/:productCode', requireAuth, requireAnyRole(['SUPER_ADMIN','LOCAL_ADMIN']), protectWriteLimit, async (req: AuthRequest, res) => {
    const iso2 = String(req.params.iso2 || '').toUpperCase();
    const code = String(req.params.productCode || '');
    if (!validIso2(iso2) || !/^[A-Z0-9_]{3,64}$/.test(code)) return res.status(400).json({ error: 'Invalid country or product code' });
    if (!requireCountryAdmin(req, res, iso2)) return;
    try {
      const readiness = await db.execute(sql`
        SELECT s.status AS country_status, s.regulatory_review_status, s.release_gates, p.id AS product_id,
               p.requires_authorized_partner
        FROM kazi_protect_country_settings s
        JOIN kazi_protect_products p ON p.product_code = ${code}
        WHERE s.country_iso2 = ${iso2} LIMIT 1
      `);
      const config = rowsOf(readiness)[0];
      if (!config) return res.status(404).json({ error: 'Country or product not found' });
      const gates = config.release_gates as Record<string, boolean>;
      const blockers = Object.entries(gates || {}).filter(([, passed]) => passed !== true).map(([key]) => key);
      if (config.country_status !== 'ACTIVE') blockers.push('countryNotActive');
      if (config.regulatory_review_status !== 'APPROVED') blockers.push('regulatoryReviewStatus');
      if (config.requires_authorized_partner) {
        const partners = await db.execute(sql`
          SELECT count(*)::int AS count FROM kazi_protect_partners
          WHERE country_iso2 = ${iso2} AND status = 'VERIFIED'
            AND partner_type IN ('INSURER','BROKER','INTERMEDIARY')
            AND territories @> ${JSON.stringify([iso2])}::jsonb
        `);
        if (Number(rowsOf(partners)[0]?.count || 0) < 1) blockers.push('verifiedAuthorizedPartner');
      }
      if (blockers.length) return res.status(409).json({ error: 'Product activation blocked', blockers });
      const activated = await db.execute(sql`
        UPDATE kazi_protect_country_products SET status = 'ACTIVE', approved_by = ${req.authCtx!.uid},
          approved_at = now(), updated_at = now()
        WHERE country_iso2 = ${iso2} AND product_id = ${config.product_id} AND status IN ('APPROVED','PENDING_REVIEW')
        RETURNING id, status
      `);
      const product = rowsOf(activated)[0];
      if (!product) return res.status(409).json({ error: 'Product must be approved before activation' });
      await db.execute(sql`
        INSERT INTO kazi_protect_audit_events (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
        VALUES (${iso2}, ${req.authCtx!.uid}, 'country_product', ${product.id}, 'COUNTRY_PRODUCT_ACTIVATED',
          ${JSON.stringify({ productCode: code })}::jsonb, ${req.requestId || null})
      `);
      return res.json({ countryIso2: iso2, productCode: code, status: product.status });
    } catch (error) {
      console.error('KAZI PROTECT product activation error:', error);
      return res.status(503).json({ error: 'Product activation failed' });
    }
  });
}
