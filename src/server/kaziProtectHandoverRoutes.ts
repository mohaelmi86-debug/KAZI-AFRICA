import type { Express, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { rateLimit, requireAnyRole, requireAuth, type AuthRequest } from '../middleware/auth.ts';

const writeLimit = rateLimit(20, 60_000);
const readLimit = rateLimit(60, 60_000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  return ((result as { rows?: T[] })?.rows || []);
}
function validRefs(value: unknown, max = 20): value is string[] {
  return Array.isArray(value) && value.length <= max &&
    value.every((v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 1000);
}
function validChecklist(value: unknown): value is Array<{ item: string; completed: boolean; note?: string }> {
  return Array.isArray(value) && value.length >= 1 && value.length <= 40 &&
    value.every((v) => v && typeof v.item === 'string' && v.item.trim().length >= 2 &&
      v.item.length <= 160 && typeof v.completed === 'boolean' &&
      (v.note === undefined || (typeof v.note === 'string' && v.note.length <= 1000)));
}

export function registerKaziProtectHandoverRoutes(app: Express): void {
  // Professional creates/submits the handover for their own assigned booking.
  app.post('/api/protect/bookings/:bookingId/handover',
    requireAuth, requireAnyRole(['PROFESSIONAL']), writeLimit, async (req: AuthRequest, res: Response) => {
      const bookingId = String(req.params.bookingId || '');
      const checklist = req.body?.checklist;
      const beforeRefs = req.body?.beforeEvidenceRefs;
      const afterRefs = req.body?.afterEvidenceRefs;
      const summary = typeof req.body?.workSummary === 'string' ? req.body.workSummary.trim() : '';
      if (!UUID.test(bookingId) || !validChecklist(checklist) || !checklist.every((item) => item.completed) || !validRefs(beforeRefs) ||
          !validRefs(afterRefs) || summary.length < 10 || summary.length > 4000 ||
          beforeRefs.length + afterRefs.length < 2) {
        return res.status(400).json({ error: 'All checklist items must be completed; work summary and before/after evidence are required' });
      }
      try {
        const result = await db.transaction(async (tx) => {
          const bookingResult = await tx.execute(sql`
            SELECT b.id, b.status, b.client_profile_id AS "clientProfileId",
              b.country_id AS "countryId", p.profile_id AS "professionalProfileId"
            FROM bookings b JOIN professionals p ON p.id = b.professional_id
            WHERE b.id = ${bookingId} FOR UPDATE OF b
          `);
          const booking = rowsOf(bookingResult)[0];
          if (!booking) return { error: 'NOT_FOUND' as const };
          if (booking.professionalProfileId !== req.authCtx!.profileId) return { error: 'FORBIDDEN' as const };
          if (!['IN_PROGRESS','AWAITING_CLIENT_VALIDATION'].includes(String(booking.status))) {
            return { error: 'INVALID_BOOKING_STATE' as const };
          }
          const previous = rowsOf(await tx.execute(sql`
            SELECT id, status FROM kazi_protect_handovers WHERE booking_id = ${bookingId} LIMIT 1
          `))[0];
          if (previous && previous.status === 'ACCEPTED') {
            return { error: 'ALREADY_FINALIZED' as const };
          }
          const saved = previous
            ? await tx.execute(sql`
                UPDATE kazi_protect_handovers SET checklist = ${JSON.stringify(checklist)}::jsonb,
                  before_evidence_refs = ${JSON.stringify(beforeRefs)}::jsonb,
                  after_evidence_refs = ${JSON.stringify(afterRefs)}::jsonb,
                  work_summary = ${summary}, status = 'SUBMITTED',
                  submitted_by_profile_id = ${req.authCtx!.profileId},
                  client_reservations = '[]'::jsonb, client_response = NULL, responded_at = NULL,
                  submitted_at = now(), updated_at = now()
                WHERE id = ${previous.id}
                RETURNING id, status, submitted_at AS "submittedAt"
              `)
            : await tx.execute(sql`
                INSERT INTO kazi_protect_handovers
                  (booking_id, country_id, client_profile_id, professional_profile_id,
                   checklist, before_evidence_refs, after_evidence_refs, work_summary,
                   status, submitted_by_profile_id, submitted_at)
                VALUES (${bookingId}, ${booking.countryId}, ${booking.clientProfileId},
                  ${req.authCtx!.profileId}, ${JSON.stringify(checklist)}::jsonb,
                  ${JSON.stringify(beforeRefs)}::jsonb, ${JSON.stringify(afterRefs)}::jsonb,
                  ${summary}, 'SUBMITTED', ${req.authCtx!.profileId}, now())
                RETURNING id, status, submitted_at AS "submittedAt"
              `);
          const handover = rowsOf(saved)[0];
          await tx.execute(sql`
            INSERT INTO kazi_protect_audit_events
              (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
            SELECT c.iso2, ${req.authCtx!.uid}, 'handover', ${handover.id},
              'HANDOVER_SUBMITTED',
              ${JSON.stringify({ bookingId, checklistItems: checklist.length, beforeEvidenceCount: beforeRefs.length, afterEvidenceCount: afterRefs.length })}::jsonb,
              ${req.requestId || null}
            FROM countries c WHERE c.id = ${booking.countryId}
          `);
          return { handover };
        });
        if ('error' in result) {
          if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Booking not found' });
          if (result.error === 'FORBIDDEN') return res.status(403).json({ error: 'Booking is not assigned to this professional' });
          return res.status(409).json({ error: 'Booking state does not allow a new handover or it has already been finalized' });
        }
        return res.status(201).json({ handover: result.handover });
      } catch (error) {
        console.error('KAZI PROTECT handover submission error:', error);
        return res.status(503).json({ error: 'Handover submission failed' });
      }
    });

  app.get('/api/protect/bookings/:bookingId/handover',
    requireAuth, readLimit, async (req: AuthRequest, res: Response) => {
      const bookingId = String(req.params.bookingId || '');
      if (!UUID.test(bookingId)) return res.status(400).json({ error: 'Invalid booking identifier' });
      try {
        const result = await db.execute(sql`
          SELECT h.id, h.booking_id AS "bookingId", h.status, h.checklist,
            h.before_evidence_refs AS "beforeEvidenceRefs", h.after_evidence_refs AS "afterEvidenceRefs",
            h.work_summary AS "workSummary", h.client_reservations AS "clientReservations",
            h.client_response AS "clientResponse", h.submitted_at AS "submittedAt",
            h.responded_at AS "respondedAt", h.created_at AS "createdAt"
          FROM kazi_protect_handovers h
          JOIN bookings b ON b.id = h.booking_id
          WHERE h.booking_id = ${bookingId}
            AND (b.client_profile_id = ${req.authCtx!.profileId}
              OR EXISTS (SELECT 1 FROM professionals p WHERE p.id = b.professional_id AND p.profile_id = ${req.authCtx!.profileId})
              OR EXISTS (SELECT 1 FROM country_admins ca JOIN countries c ON c.id = ca.country_id
                WHERE ca.profile_id = ${req.authCtx!.profileId} AND c.id = b.country_id)
              OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.profile_id = ${req.authCtx!.profileId} AND ur.role = 'SUPER_ADMIN'))
          LIMIT 1
        `);
        const handover = rowsOf(result)[0];
        if (!handover) return res.status(404).json({ error: 'Handover not found or access denied' });
        return res.json({ handover });
      } catch (error) {
        console.error('KAZI PROTECT handover lookup error:', error);
        return res.status(503).json({ error: 'Handover lookup failed' });
      }
    });

  // Client can accept the handover or record reservations. Acceptance is not the same as booking completion.
  app.post('/api/protect/handovers/:handoverId/respond',
    requireAuth, requireAnyRole(['CLIENT']), writeLimit, async (req: AuthRequest, res: Response) => {
      const handoverId = String(req.params.handoverId || '');
      const decision = String(req.body?.decision || '');
      const reservations = req.body?.reservations ?? [];
      const responseNote = typeof req.body?.responseNote === 'string' ? req.body.responseNote.trim() : '';
      if (!UUID.test(handoverId) || !['ACCEPT','RESERVE'].includes(decision) ||
          !Array.isArray(reservations) || reservations.length > 30 ||
          reservations.some((v: unknown) => typeof v !== 'string' || !v.trim() || v.length > 1000) ||
          responseNote.length > 2000 || (decision === 'RESERVE' && reservations.length === 0) ||
          (decision === 'ACCEPT' && reservations.length > 0)) {
        return res.status(400).json({ error: 'Invalid handover response' });
      }
      try {
        const result = await db.transaction(async (tx) => {
          const current = rowsOf(await tx.execute(sql`
            SELECT h.id, h.status, h.country_id AS "countryId", h.client_profile_id AS "clientProfileId",
              h.booking_id AS "bookingId"
            FROM kazi_protect_handovers h WHERE h.id = ${handoverId} FOR UPDATE
          `))[0];
          if (!current) return { error: 'NOT_FOUND' as const };
          if (current.clientProfileId !== req.authCtx!.profileId) return { error: 'FORBIDDEN' as const };
          if (current.status !== 'SUBMITTED') return { error: 'INVALID_STATE' as const };
          const next = decision === 'ACCEPT' ? 'ACCEPTED' : 'RESERVATIONS_RECORDED';
          const updated = rowsOf(await tx.execute(sql`
            UPDATE kazi_protect_handovers SET status = ${next},
              client_reservations = ${JSON.stringify(reservations)}::jsonb,
              client_response = ${responseNote || null}, responded_at = now(), updated_at = now()
            WHERE id = ${handoverId} AND status = 'SUBMITTED'
            RETURNING id, status, client_reservations AS "clientReservations",
              client_response AS "clientResponse", responded_at AS "respondedAt"
          `))[0];
          await tx.execute(sql`
            INSERT INTO kazi_protect_audit_events
              (country_iso2, actor_uid, entity_type, entity_id, action, after_state, request_id)
            SELECT c.iso2, ${req.authCtx!.uid}, 'handover', ${handoverId},
              ${decision === 'ACCEPT' ? 'HANDOVER_ACCEPTED' : 'HANDOVER_RESERVATIONS_RECORDED'},
              ${JSON.stringify({ decision, reservations, responseNote })}::jsonb,
              ${req.requestId || null}
            FROM countries c WHERE c.id = ${current.countryId}
          `);
          return { handover: updated };
        });
        if ('error' in result) {
          if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Handover not found' });
          if (result.error === 'FORBIDDEN') return res.status(403).json({ error: 'Only the booking client can respond' });
          return res.status(409).json({ error: 'Handover is no longer awaiting a client response' });
        }
        return res.json({ handover: result.handover });
      } catch (error) {
        console.error('KAZI PROTECT handover response error:', error);
        return res.status(503).json({ error: 'Handover response failed' });
      }
    });
}
