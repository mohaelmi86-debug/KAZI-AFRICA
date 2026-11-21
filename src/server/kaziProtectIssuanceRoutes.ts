import type { Express, Response } from 'express';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { rateLimit, requireAnyRole, requireAuth, type AuthRequest } from '../middleware/auth.ts';

const writeLimit = rateLimit(10, 60_000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WARRANTY_CODES = new Set(['SERVICE_WARRANTY', 'WORKMANSHIP_GUARANTEE', 'PRODUCT_WARRANTY']);
function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  return ((result as { rows?: T[] })?.rows || []);
}
function countryAdmin(req: AuthRequest, iso2: string): boolean {
  return req.authCtx!.roles.includes('SUPER_ADMIN') ||
    (req.authCtx!.roles.includes('LOCAL_ADMIN') && req.authCtx!.adminCountryIso2s.includes(iso2));
}

export function registerKaziProtectIssuanceRoutes(app: Express): void {
  // Contract terms are centrally controlled. A local admin cannot publish or change legal wording.
  app.patch('/api/protect/admin/countries/:iso2/products/:productCode/warranty-config',
    requireAuth, requireAnyRole(['SUPER_ADMIN']), writeLimit, async (req: AuthRequest, res: Response) => {
      const iso2 = String(req.params.iso2 || '').toUpperCase();
      const code = String(req.params.productCode || '');
      const body = req.body || {};
      const days = Number(body.warrantyDurationDays);
      const evidenceRef = typeof body.approvalEvidenceRef === 'string' ? body.approvalEvidenceRef.trim() : '';
      const coverageSummary = typeof body.coverageSummary === 'string' ? body.coverageSummary.trim() : '';
      const exclusions = body.exclusions;
      if (!/^[A-Z]{2}$/.test(iso2) || !WARRANTY_CODES.has(code) ||
          !Number.isInteger(days) || days < 1 || days > 3650 ||
          evidenceRef.length < 5 || evidenceRef.length > 500 ||
          coverageSummary.length < 10 || coverageSummary.length > 2000 ||
          !Array.isArray(exclusions) || exclusions.length > 30 ||
          exclusions.some((v: unknown) => typeof v !== 'string' || !v.trim() || v.length > 500)) {
        return res.status(400).json({ error: 'Invalid warranty configuration or approval evidence' });
      }
      try {
        const result = await db.execute(sql`
          UPDATE kazi_protect_country_products cp
          SET local_config = cp.local_config || ${JSON.stringify({
            warrantyDurationDays: days,
            warrantyCoverageSummary: coverageSummary,
            warrantyExclusions: exclusions,
            warrantyConfigEvidenceRef: evidenceRef,
            warrantyConfigApprovedBy: req.authCtx!.uid,
            warrantyConfigApprovedAt: new Date().toISOString(),
          })}::jsonb, updated_at = now()
          FROM kazi_protect_products p
          WHERE cp.product_id = p.id AND cp.country_iso2 = ${iso2}
            AND p.product_code = ${code} AND p.category = 'WARRANTY'
            AND cp.status IN ('APPROVED','ACTIVE')
            AND cp.terms_version IS NOT NULL AND cp.disclosure_version IS NOT NULL
          RETURNING cp.id, cp.status, cp.terms_version AS "termsVersion",
            cp.disclosure_version AS "disclosureVersion", cp.local_config AS "localConfig"
        `);
        const config = rowsOf(result)[0];
        if (!config) return res.status(409).json({ error: 'Warranty must be approved with terms and disclosure versions before configuration' });
        await db.execute(sql`
          INSERT INTO kazi_protect_audit_events
            (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
          VALUES (${iso2}, ${req.authCtx!.uid}, 'country_product', ${config.id},
            'WARRANTY_CONFIG_APPROVED',
            ${JSON.stringify({ productCode: code, warrantyDurationDays: days, approvalEvidenceRef: evidenceRef })}::jsonb,
            ${req.requestId || null})
        `);
        return res.json({ countryIso2: iso2, productCode: code, configuration: {
          warrantyDurationDays: days, termsVersion: config.termsVersion,
          disclosureVersion: config.disclosureVersion,
        }});
      } catch (error) {
        console.error('KAZI PROTECT warranty configuration error:', error);
        return res.status(503).json({ error: 'Warranty configuration failed' });
      }
    });

  // Administrative revocation is limited to KAZI contractual warranties; insurer policies remain partner-controlled.
  app.post('/api/protect/admin/certificates/:certificateId/revoke',
    requireAuth, requireAnyRole(['SUPER_ADMIN','LOCAL_ADMIN']), writeLimit,
    async (req: AuthRequest, res: Response) => {
      const certificateId = String(req.params.certificateId || '');
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const evidenceRef = typeof req.body?.evidenceRef === 'string' ? req.body.evidenceRef.trim() : '';
      if (!UUID.test(certificateId) || reason.length < 10 || reason.length > 2000 ||
          evidenceRef.length < 5 || evidenceRef.length > 500) {
        return res.status(400).json({ error: 'A valid certificate, reason and evidence reference are required' });
      }
      try {
        const result = await db.transaction(async (tx) => {
          const current = rowsOf(await tx.execute(sql`
            SELECT id, country_iso2 AS "countryIso2", protection_kind AS "protectionKind",
              status, certificate_number AS "certificateNumber"
            FROM kazi_protect_certificates WHERE id = ${certificateId} FOR UPDATE
          `))[0];
          if (!current) return { error: 'NOT_FOUND' as const };
          if (current.protectionKind !== 'CONTRACTUAL_WARRANTY') return { error: 'PARTNER_CONTROLLED' as const };
          const iso2 = String(current.countryIso2);
          if (!req.authCtx!.roles.includes('SUPER_ADMIN') &&
              (!req.authCtx!.roles.includes('LOCAL_ADMIN') || !req.authCtx!.adminCountryIso2s.includes(iso2))) {
            return { error: 'FORBIDDEN' as const };
          }
          if (!['ACTIVE','ISSUED'].includes(String(current.status))) return { error: 'INVALID_STATE' as const };
          const updated = rowsOf(await tx.execute(sql`
            UPDATE kazi_protect_certificates SET status = 'REVOKED', updated_at = now()
            WHERE id = ${certificateId} AND status IN ('ACTIVE','ISSUED')
            RETURNING id, certificate_number AS "certificateNumber", status
          `))[0];
          await tx.execute(sql`
            INSERT INTO kazi_protect_audit_events
              (country_iso2, actor_uid, entity_type, entity_id, action, before_state, after_state, request_id)
            VALUES (${iso2}, ${req.authCtx!.uid}, 'certificate', ${certificateId},
              'CONTRACTUAL_WARRANTY_REVOKED',
              ${JSON.stringify({ status: current.status })}::jsonb,
              ${JSON.stringify({ status: 'REVOKED', reason, evidenceRef })}::jsonb,
              ${req.requestId || null})
          `);
          return { certificate: updated };
        });
        if ('error' in result) {
          if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Certificate not found' });
          if (result.error === 'FORBIDDEN') return res.status(403).json({ error: 'Country scope not authorized' });
          if (result.error === 'PARTNER_CONTROLLED') return res.status(409).json({ error: 'Insurance policy status must be changed by the issuing insurer or authorized partner' });
          return res.status(409).json({ error: 'Certificate is not in a revocable state' });
        }
        return res.json({ certificate: result.certificate });
      } catch (error) {
        console.error('KAZI PROTECT certificate revocation error:', error);
        return res.status(503).json({ error: 'Certificate revocation failed' });
      }
    });

  // One contractual warranty certificate per completed and client-validated booking.
  app.post('/api/protect/bookings/:bookingId/issue-warranty',
    requireAuth, requireAnyRole(['PROFESSIONAL','LOCAL_ADMIN','SUPER_ADMIN']), writeLimit,
    async (req: AuthRequest, res: Response) => {
      const bookingId = String(req.params.bookingId || '');
      const code = String(req.body?.productCode || 'WORKMANSHIP_GUARANTEE');
      if (!UUID.test(bookingId) || !WARRANTY_CODES.has(code)) {
        return res.status(400).json({ error: 'Invalid booking or warranty product' });
      }
      try {
        const result = await db.transaction(async (tx) => {
          const bookingResult = await tx.execute(sql`
            SELECT b.id, b.country_id AS "countryId", b.client_profile_id AS "clientProfileId",
              b.professional_id AS "professionalId", b.mission_id AS "missionId",
              b.country_id, c.iso2 AS "countryIso2", b.status AS "bookingStatus",
              b.client_validated_at AS "clientValidatedAt", pp.profile_id AS "professionalProfileId"
            FROM bookings b
            JOIN countries c ON c.id = b.country_id
            JOIN professionals pp ON pp.id = b.professional_id
            WHERE b.id = ${bookingId}
            FOR UPDATE OF b
          `);
          const booking = rowsOf(bookingResult)[0];
          if (!booking) return { error: 'NOT_FOUND' as const };
          const iso2 = String(booking.countryIso2);
          const actorIsAdmin = countryAdmin(req, iso2);
          if (!actorIsAdmin && booking.professionalProfileId !== req.authCtx!.profileId) {
            return { error: 'FORBIDDEN' as const };
          }
          if (booking.bookingStatus !== 'COMPLETED' || !booking.clientValidatedAt) {
            return { error: 'BOOKING_NOT_VALIDATED' as const };
          }
          const handoverResult = await tx.execute(sql`
            SELECT id FROM kazi_protect_handovers
            WHERE booking_id = ${bookingId} AND status = 'ACCEPTED'
            LIMIT 1
          `);
          if (!rowsOf(handoverResult)[0]) return { error: 'HANDOVER_NOT_ACCEPTED' as const };
          const existingResult = await tx.execute(sql`
            SELECT id, certificate_number AS "certificateNumber", status, starts_at AS "startsAt",
              ends_at AS "endsAt"
            FROM kazi_protect_certificates
            WHERE booking_id = ${bookingId} AND protection_kind = 'CONTRACTUAL_WARRANTY'
            LIMIT 1
          `);
          const existing = rowsOf(existingResult)[0];
          if (existing) return { certificate: existing, replay: true };
          const productResult = await tx.execute(sql`
            SELECT cp.id, cp.terms_version AS "termsVersion",
              cp.disclosure_version AS "disclosureVersion", cp.local_config AS "localConfig",
              s.currency_code AS currency
            FROM kazi_protect_country_settings s
            JOIN kazi_protect_country_products cp ON cp.country_iso2 = s.country_iso2
            JOIN kazi_protect_products p ON p.id = cp.product_id
            WHERE s.country_iso2 = ${iso2} AND s.status = 'ACTIVE'
              AND s.regulatory_review_status = 'APPROVED' AND cp.status = 'ACTIVE'
              AND p.product_code = ${code} AND p.category = 'WARRANTY'
              AND (s.release_gates->>'legalReview')::boolean IS TRUE
              AND (s.release_gates->>'partnerVerified')::boolean IS TRUE
              AND (s.release_gates->>'wordingApproved')::boolean IS TRUE
              AND (s.release_gates->>'claimsProcessReady')::boolean IS TRUE
              AND (s.release_gates->>'privacyReview')::boolean IS TRUE
              AND (s.release_gates->>'paymentFlowVerified')::boolean IS TRUE
              AND (s.release_gates->>'countryUatPassed')::boolean IS TRUE
            LIMIT 1
          `);
          const product = rowsOf(productResult)[0];
          if (!product) return { error: 'PRODUCT_NOT_ACTIVE' as const };
          const config = product.localConfig as Record<string, unknown>;
          const days = Number(config?.warrantyDurationDays);
          const coverageSummary = typeof config?.warrantyCoverageSummary === 'string' ? config.warrantyCoverageSummary : '';
          const exclusions = Array.isArray(config?.warrantyExclusions) ? config.warrantyExclusions : [];
          if (!Number.isInteger(days) || days < 1 || days > 3650 || coverageSummary.length < 10 ||
              !product.termsVersion || !product.disclosureVersion) return { error: 'WARRANTY_CONFIG_INCOMPLETE' as const };
          const now = new Date();
          const endsAt = new Date(now.getTime() + days * 86_400_000);
          const token = crypto.randomBytes(32).toString('base64url');
          const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
          const certificateNumber = `KZP-${iso2}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
          const inserted = await tx.execute(sql`
            INSERT INTO kazi_protect_certificates
              (certificate_number, verification_token_hash, country_iso2, owner_profile_id,
               mission_id, booking_id, protected_object_type, protection_kind, issuer_type,
               coverage_summary, exclusions, starts_at, ends_at, status, issued_at)
            VALUES (${certificateNumber}, ${tokenHash}, ${iso2}, ${booking.clientProfileId},
              ${booking.missionId}, ${bookingId}, 'WORK', 'CONTRACTUAL_WARRANTY', 'PROFESSIONAL',
              ${JSON.stringify({
                productCode: code, summary: coverageSummary, termsVersion: product.termsVersion,
                disclosureVersion: product.disclosureVersion, warrantyDurationDays: days,
                currency: product.currency || null,
              })}::jsonb, ${JSON.stringify(exclusions)}::jsonb, ${now.toISOString()},
              ${endsAt.toISOString()}, 'ACTIVE', ${now.toISOString()})
            RETURNING id, certificate_number AS "certificateNumber", status,
              starts_at AS "startsAt", ends_at AS "endsAt"
          `);
          const certificate = rowsOf(inserted)[0];
          await tx.execute(sql`
            INSERT INTO kazi_protect_audit_events
              (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
            VALUES (${iso2}, ${req.authCtx!.uid}, 'certificate', ${certificate.id},
              'CONTRACTUAL_WARRANTY_ISSUED',
              ${JSON.stringify({ certificateNumber, bookingId, productCode: code, issuerType: 'PROFESSIONAL', termsVersion: product.termsVersion, endsAt: endsAt.toISOString() })}::jsonb,
              ${req.requestId || null})
          `);
          return { certificate, token, replay: false };
        });
        if ('error' in result) {
          if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Booking not found' });
          if (result.error === 'FORBIDDEN') return res.status(403).json({ error: 'Booking is not assigned to this professional' });
          if (result.error === 'BOOKING_NOT_VALIDATED') return res.status(409).json({ error: 'Booking must be completed and validated by the client' });
          if (result.error === 'HANDOVER_NOT_ACCEPTED') return res.status(409).json({ error: 'Client must accept the handover before warranty issuance' });
          if (result.error === 'PRODUCT_NOT_ACTIVE') return res.status(409).json({ error: 'Warranty product is not active for this country' });
          return res.status(409).json({ error: 'Approved warranty duration, wording and exclusions are required before issuance' });
        }
        res.setHeader('Cache-Control', 'no-store');
        return res.status(result.replay ? 200 : 201).json({
          certificate: result.certificate,
          verificationToken: result.replay ? null : result.token,
          idempotentReplay: result.replay,
          tokenNotice: result.replay ? 'The verification token is shown only once at initial issuance.' : 'Store this token securely; it cannot be retrieved again.',
        });
      } catch (error) {
        console.error('KAZI PROTECT warranty issuance error:', error);
        return res.status(503).json({ error: 'Warranty issuance failed' });
      }
    });
}
