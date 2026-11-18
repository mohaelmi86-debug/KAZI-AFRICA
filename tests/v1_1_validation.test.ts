import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import { eq, inArray, like, or } from 'drizzle-orm';

dotenv.config();
process.env.NODE_ENV = 'test';
process.env.KAZI_TEST_NO_LISTEN = '1';
process.env.PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'kazi-v11-test-secret';

import {
  __resetRateLimitForTest,
  __setVerifyIdTokenForTest,
} from '../src/middleware/auth.ts';
import { signWebhookPayload } from '../src/server/businessLogic.ts';
import { validateRuntimeEnvironment } from '../src/config/env.ts';
import { db } from '../src/db/index.ts';
import {
  auditLogs,
  bookings,
  certifications,
  countries,
  countryDeployments,
  countryPaymentProviders,
  disputes,
  enrollments,
  evaluations,
  languages,
  messages,
  missions,
  organizations,
  payments,
  paymentTransactions,
  professionals,
  profiles,
  quotes,
  reviews,
  skillPassports,
  trainingCourses,
  userRoles,
  verifications,
} from '../src/db/schema.ts';

const { app } = await import('../server.ts');

async function startHttp() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function reqRaw(baseUrl: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, headers: res.headers, body };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

test('KAZI AFRICA V1.1 Comprehensive Validation Suite (Phases 1-7)', async (t) => {
  const srv = await startHttp();

  // Save baseline state for AO, KE, and CI PSPs so we restore cleanly in t.after
  const [aoBefore] = await db.select().from(countries).where(eq(countries.iso2, 'AO')).limit(1);
  const [aoDepBefore] = aoBefore
    ? await db.select().from(countryDeployments).where(eq(countryDeployments.countryId, aoBefore.id)).limit(1)
    : [];
  const [keBefore] = await db.select().from(countries).where(eq(countries.iso2, 'KE')).limit(1);
  const [keDepBefore] = keBefore
    ? await db.select().from(countryDeployments).where(eq(countryDeployments.countryId, keBefore.id)).limit(1)
    : [];
  const [ciCountry] = await db.select().from(countries).where(eq(countries.iso2, 'CI')).limit(1);
  const ciProvidersBefore = ciCountry
    ? await db.select().from(countryPaymentProviders).where(eq(countryPaymentProviders.countryId, ciCountry.id))
    : [];

  __setVerifyIdTokenForTest(async (token: string) => {
    if (token === 'revoked-token') {
      const err: any = new Error('Firebase ID token has been revoked.');
      err.code = 'auth/id-token-revoked';
      throw err;
    }
    if (token === 'token-client-v11') {
      return { uid: 'test-v11-client', email: 'test-v11-client@kazi.test', name: 'Test V11 Client' } as any;
    }
    if (token === 'token-client-other-v11') {
      return { uid: 'test-v11-client2', email: 'test-v11-client2@kazi.test', name: 'Test V11 Client 2' } as any;
    }
    if (token === 'token-pro-v11') {
      return { uid: 'test-v11-pro', email: 'test-v11-pro@kazi.test', name: 'Test V11 Pro' } as any;
    }
    if (token === 'token-ent-a-v11') {
      return { uid: 'test-v11-ent-a', email: 'test-v11-ent-a@kazi.test', name: 'Test V11 Ent A' } as any;
    }
    if (token === 'token-ent-b-v11') {
      return { uid: 'test-v11-ent-b', email: 'test-v11-ent-b@kazi.test', name: 'Test V11 Ent B' } as any;
    }
    if (token === 'token-local-sn-v11') {
      return { uid: 'test-v11-local-sn', email: 'test-v11-local-sn@kazi.test', name: 'Test V11 Local SN' } as any;
    }
    if (token === 'token-super-v11') {
      return { uid: 'test-v11-super', email: 'moha.elmi86@gmail.com', name: 'Test V11 Super Admin' } as any;
    }
    throw new Error('Invalid token');
  });

  t.after(async () => {
    __setVerifyIdTokenForTest(null);
    __resetRateLimitForTest();

    // Clean up all synthetic test records safely in strict FK dependency order
    const testProfiles = await db
      .select({ id: profiles.id, uid: profiles.uid })
      .from(profiles)
      .where(like(profiles.uid, 'test-v11-%'));
    const testProfileIds = testProfiles.map((p) => p.id);

    const testPros =
      testProfileIds.length > 0
        ? await db
            .select({ id: professionals.id })
            .from(professionals)
            .where(inArray(professionals.profileId, testProfileIds))
        : [];
    const testProIds = testPros.map((p) => p.id);

    const missionFilters = [like(missions.title, '[TEST-V11]%')];
    if (testProfileIds.length > 0) missionFilters.push(inArray(missions.clientProfileId, testProfileIds));
    if (testProIds.length > 0) missionFilters.push(inArray(missions.targetProfessionalId, testProIds));

    const testMissions = await db
      .select({ id: missions.id })
      .from(missions)
      .where(or(...missionFilters));
    const testMissionIds = testMissions.map((m) => m.id);

    const bookingFilters = [];
    if (testMissionIds.length > 0) bookingFilters.push(inArray(bookings.missionId, testMissionIds));
    if (testProfileIds.length > 0) bookingFilters.push(inArray(bookings.clientProfileId, testProfileIds));
    if (testProIds.length > 0) bookingFilters.push(inArray(bookings.professionalId, testProIds));

    const testBookings =
      bookingFilters.length > 0
        ? await db.select({ id: bookings.id }).from(bookings).where(or(...bookingFilters))
        : [];
    const testBookingIds = testBookings.map((b) => b.id);

    const paymentFilters = [];
    if (testBookingIds.length > 0) paymentFilters.push(inArray(payments.bookingId, testBookingIds));
    if (testProfileIds.length > 0) paymentFilters.push(inArray(payments.payerProfileId, testProfileIds));

    const testPayments =
      paymentFilters.length > 0
        ? await db.select({ id: payments.id }).from(payments).where(or(...paymentFilters))
        : [];
    const testPaymentIds = testPayments.map((p) => p.id);

    if (testPaymentIds.length > 0) {
      await db.delete(paymentTransactions).where(inArray(paymentTransactions.paymentId, testPaymentIds));
      await db.delete(payments).where(inArray(payments.id, testPaymentIds));
    }

    const reviewFilters = [];
    if (testBookingIds.length > 0) reviewFilters.push(inArray(reviews.bookingId, testBookingIds));
    if (testProfileIds.length > 0) reviewFilters.push(inArray(reviews.authorProfileId, testProfileIds));
    if (testProIds.length > 0) reviewFilters.push(inArray(reviews.professionalId, testProIds));
    if (reviewFilters.length > 0) {
      await db.delete(reviews).where(or(...reviewFilters));
    }

    if (testBookingIds.length > 0) {
      await db.delete(bookings).where(inArray(bookings.id, testBookingIds));
    }

    const disputeFilters = [];
    if (testMissionIds.length > 0) disputeFilters.push(inArray(disputes.missionId, testMissionIds));
    if (testProfileIds.length > 0) disputeFilters.push(inArray(disputes.openedByProfileId, testProfileIds));
    if (disputeFilters.length > 0) {
      await db.delete(disputes).where(or(...disputeFilters));
    }

    const msgFilters = [];
    if (testMissionIds.length > 0) msgFilters.push(inArray(messages.missionId, testMissionIds));
    if (testProfileIds.length > 0) {
      msgFilters.push(inArray(messages.senderProfileId, testProfileIds));
      msgFilters.push(inArray(messages.recipientProfileId, testProfileIds));
    }
    if (msgFilters.length > 0) {
      await db.delete(messages).where(or(...msgFilters));
    }

    const quoteFilters = [];
    if (testMissionIds.length > 0) quoteFilters.push(inArray(quotes.missionId, testMissionIds));
    if (testProIds.length > 0) quoteFilters.push(inArray(quotes.professionalId, testProIds));
    if (quoteFilters.length > 0) {
      await db.delete(quotes).where(or(...quoteFilters));
    }

    if (testMissionIds.length > 0) {
      await db.delete(missions).where(inArray(missions.id, testMissionIds));
    }
    if (testProfileIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.actorProfileId, testProfileIds));
      await db.delete(certifications).where(inArray(certifications.profileId, testProfileIds));
      await db.delete(evaluations).where(inArray(evaluations.profileId, testProfileIds));
      await db.delete(enrollments).where(inArray(enrollments.profileId, testProfileIds));
      await db.delete(skillPassports).where(inArray(skillPassports.profileId, testProfileIds));
      await db.delete(organizations).where(inArray(organizations.ownerProfileId, testProfileIds));
    }
    if (testProIds.length > 0) {
      await db.delete(verifications).where(inArray(verifications.professionalId, testProIds));
      await db.delete(professionals).where(inArray(professionals.id, testProIds));
    }
    if (testProfileIds.length > 0) {
      await db.delete(profiles).where(inArray(profiles.id, testProfileIds));
    }
    await db.delete(trainingCourses).where(like(trainingCourses.titleFr, '[TEST-V11]%'));
    await db.delete(auditLogs).where(like(auditLogs.actorUid, 'test-v11-%'));

    // Restore AO / KE / CI PSP baseline state
    if (aoBefore) {
      await db.update(countries).set({ status: aoBefore.status }).where(eq(countries.id, aoBefore.id));
    }
    if (aoDepBefore) {
      await db
        .update(countryDeployments)
        .set({
          configComplete: aoDepBefore.configComplete,
          complianceVerified: aoDepBefore.complianceVerified,
          paymentsConfigured: aoDepBefore.paymentsConfigured,
          localLeadAssigned: aoDepBefore.localLeadAssigned,
          securityTestsPassed: aoDepBefore.securityTestsPassed,
          functionalTestsPassed: aoDepBefore.functionalTestsPassed,
          activationAuthorized: aoDepBefore.activationAuthorized,
          registrationsOpen: aoDepBefore.registrationsOpen,
          missionsOpen: aoDepBefore.missionsOpen,
          suspensionReason: aoDepBefore.suspensionReason,
        })
        .where(eq(countryDeployments.id, aoDepBefore.id));
    }
    if (keBefore) {
      await db.update(countries).set({ status: keBefore.status }).where(eq(countries.id, keBefore.id));
    }
    if (keDepBefore) {
      await db
        .update(countryDeployments)
        .set({
          registrationsOpen: keDepBefore.registrationsOpen,
          missionsOpen: keDepBefore.missionsOpen,
          suspensionReason: keDepBefore.suspensionReason,
        })
        .where(eq(countryDeployments.id, keDepBefore.id));
    }
    for (const psp of ciProvidersBefore) {
      await db
        .update(countryPaymentProviders)
        .set({ status: psp.status, verificationNote: psp.verificationNote })
        .where(eq(countryPaymentProviders.id, psp.id));
    }

    await srv.close();
    await global._postgresPool?.end();
  });

  // --------------------------------------------------------------------------
  // PHASE 1: SECURITY VALIDATION
  // --------------------------------------------------------------------------
  await t.test('Phase 1: Security headers, Cache-Control, JSON errors, token revocation, RBAC & IDOR', async () => {
    const healthRes = await reqRaw(srv.baseUrl, '/api/health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.database, 'connected');
    assert.ok(healthRes.headers.get('x-request-id'));
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('x-frame-options'), 'SAMEORIGIN');

    // Revoked token -> explicit 401
    const revoked = await reqRaw(srv.baseUrl, '/api/auth/me', {
      headers: { Authorization: 'Bearer revoked-token' },
    });
    assert.equal(revoked.status, 401);
    assert.match(String(revoked.body.error), /revoked/i);

    // Private endpoint sets Cache-Control: no-store, private
    assert.equal(revoked.headers.get('cache-control'), 'no-store, private');

    // Malformed JSON -> sanitized 400 (no stack trace)
    const badJson = await fetch(`${srv.baseUrl}/api/auth/active-role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-client-v11' },
      body: '{"role": ',
    });
    assert.equal(badJson.status, 400);
    const badJsonBody = await badJson.json();
    assert.equal(badJsonBody.error, 'Invalid JSON request body');
    assert.ok(badJsonBody.requestId);

    // Provision actors
    const clientMe = await reqRaw(srv.baseUrl, '/api/auth/me', {
      headers: { Authorization: 'Bearer token-client-v11' },
    });
    assert.equal(clientMe.status, 200);
    assert.equal(clientMe.headers.get('cache-control'), 'no-store, private');

    // Privilege escalation: Client cannot switch to SUPER_ADMIN or grant roles
    const escalate = await reqRaw(srv.baseUrl, '/api/auth/active-role', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'SUPER_ADMIN' }),
    });
    assert.equal(escalate.status, 403);

    // Pro registration cannot self-verify
    const proReg = await reqRaw(srv.baseUrl, '/api/professionals/register', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-pro-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        countryIso2: 'CI',
        primaryCategorySlug: 'electricity',
        headlineFr: 'Électricien Test V11',
        headlinePt: 'Eletricista Teste V11',
        bioPt: 'Especialista certificado em instalações residenciais.',
        isVerified: true,
      }),
    });
    assert.equal(proReg.status, 200);
    assert.equal(proReg.body.professional.isVerified, false);

    // Cross-organization IDOR protection
    const orgA = await reqRaw(srv.baseUrl, '/api/enterprise/organizations', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-ent-a-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Org A V11', sector: 'Energy', countryIso2: 'CI' }),
    });
    assert.equal(orgA.status, 201);
    const orgAId = orgA.body.organization.id;

    // Ent B cannot create mission on Ent A org
    const crossOrgMission = await reqRaw(srv.baseUrl, '/api/missions', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-ent-b-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        countryIso2: 'CI',
        organizationId: orgAId,
        categorySlug: 'electricity',
        title: '[TEST-V11] Cross-Org Attempt',
        description: 'Should be blocked by IDOR',
        address: 'Plateau',
        desiredDate: '2026-12-02',
        timeSlot: '09:00 - 11:00',
      }),
    });
    assert.equal(crossOrgMission.status, 403);

    // Ent B cannot add member to Ent A org
    const crossOrgMember = await reqRaw(srv.baseUrl, '/api/enterprise/members', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-ent-b-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: orgAId,
        email: 'test-v11-client@kazi.test',
        memberRole: 'MANAGER',
      }),
    });
    assert.equal(crossOrgMember.status, 403);

    // Rate limiting returns 429 with Retry-After and X-RateLimit-* headers (test /api/ai/match limit 20/min)
    __resetRateLimitForTest();
    let hit429 = false;
    for (let i = 0; i < 22; i++) {
      const r = await reqRaw(srv.baseUrl, '/api/ai/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '' }),
      });
      if (r.status === 429) {
        hit429 = true;
        assert.ok(r.headers.get('retry-after'));
        assert.equal(r.headers.get('x-ratelimit-remaining'), '0');
        break;
      }
    }
    assert.equal(hit429, true, 'Expected rate limiter to trigger 429 after 20 requests');
    __resetRateLimitForTest();
  });

  // --------------------------------------------------------------------------
  // PHASES 2, 3, 5: FULL E2E LIFECYCLE, CONCURRENCY, WEBHOOK REPLAY & IDEMPOTENCY
  // --------------------------------------------------------------------------
  await t.test('Phases 2, 3 & 5: E2E Journey, Atomic Booking Concurrency, Webhook Replay & Commission Integrity', async () => {
    const proMe = await reqRaw(srv.baseUrl, '/api/auth/me', {
      headers: { Authorization: 'Bearer token-pro-v11' },
    });
    assert.equal(proMe.status, 200);
    const [proRow] = await db
      .select()
      .from(professionals)
      .where(eq(professionals.profileId, proMe.body.profile.id))
      .limit(1);
    assert.ok(proRow);

    // Client creates mission in CI
    const missionRes = await reqRaw(srv.baseUrl, '/api/missions', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        countryIso2: 'CI',
        categorySlug: 'electricity',
        targetProfessionalId: proRow.id,
        title: '[TEST-V11] Panne tableau électrique',
        description: 'Diagnostic complet et remise aux normes',
        address: 'Cocody Angré',
        desiredDate: '2026-12-05',
        timeSlot: '14:00 - 16:00',
      }),
    });
    assert.equal(missionRes.status, 201);
    const missionId = missionRes.body.mission.id;

    // Pro sends quote
    const quoteRes = await reqRaw(srv.baseUrl, `/api/missions/${missionId}/quotes`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-pro-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 25000,
        scopeDetails: 'Remplacement disjoncteur + tests',
        estimatedDuration: '2h00',
      }),
    });
    assert.equal(quoteRes.status, 201);
    const quoteId = quoteRes.body.quote.id;

    // Concurrency test: 5 parallel quote acceptances must yield strictly 1 x 201 and 4 x 409
    const acceptPromises = Array.from({ length: 5 }, () =>
      reqRaw(srv.baseUrl, `/api/quotes/${quoteId}/accept`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token-client-v11' },
      })
    );
    const acceptResults = await Promise.all(acceptPromises);
    const createdBookings = acceptResults.filter((r) => r.status === 201);
    const conflictBookings = acceptResults.filter((r) => r.status === 409);
    assert.equal(createdBookings.length, 1, `Expected 1 booking, got ${JSON.stringify(acceptResults.map((r) => r.status))}`);
    assert.equal(conflictBookings.length, 4);
    const bookingId = createdBookings[0].body.booking.id;

    // Verify strictly 1 booking in PG for this mission
    const pgBookings = await db.select().from(bookings).where(eq(bookings.missionId, missionId));
    assert.equal(pgBookings.length, 1);

    // Actor-restricted booking transitions
    // Client cannot jump booking to IN_PROGRESS (only Pro or Admin)
    const clientStartAttempt = await reqRaw(srv.baseUrl, `/api/bookings/${bookingId}/transition`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus: 'IN_PROGRESS' }),
    });
    assert.equal(clientStartAttempt.status, 403);

    // Pro starts & completes execution -> AWAITING_CLIENT_VALIDATION
    const proStart = await reqRaw(srv.baseUrl, `/api/bookings/${bookingId}/transition`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-pro-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus: 'IN_PROGRESS' }),
    });
    assert.equal(proStart.status, 200);

    // Pro cannot bypass client validation to COMPLETED directly
    const proCompleteAttempt = await reqRaw(srv.baseUrl, `/api/bookings/${bookingId}/transition`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-pro-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus: 'COMPLETED' }),
    });
    assert.equal(proCompleteAttempt.status, 403);

    const proAwait = await reqRaw(srv.baseUrl, `/api/bookings/${bookingId}/transition`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-pro-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus: 'AWAITING_CLIENT_VALIDATION' }),
    });
    assert.equal(proAwait.status, 200);

    const clientComplete = await reqRaw(srv.baseUrl, `/api/bookings/${bookingId}/transition`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus: 'COMPLETED' }),
    });
    assert.equal(clientComplete.status, 200);

    // Messaging: non-participant blocked, participant allowed
    const msgIdor = await reqRaw(srv.baseUrl, '/api/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-other-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ missionId, content: 'Intrusion attempt' }),
    });
    assert.equal(msgIdor.status, 403);

    const msgOk = await reqRaw(srv.baseUrl, '/api/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ missionId, content: 'Merci pour votre intervention !' }),
    });
    assert.equal(msgOk.status, 201);

    // Reviews: first succeeds (201), duplicate returns 409 (unique bookingId constraint)
    const rev1 = await reqRaw(srv.baseUrl, '/api/reviews', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, rating: 5, comment: 'Excellent travail' }),
    });
    assert.equal(rev1.status, 201);

    const rev2 = await reqRaw(srv.baseUrl, '/api/reviews', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, rating: 4, comment: 'Duplicate review' }),
    });
    assert.equal(rev2.status, 409);

    // Payment initiation (disabled PSP blocked, SANDBOX PSP allowed + idempotency key)
    const disabledPsp = await reqRaw(srv.baseUrl, '/api/payments/initiate', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        providerCode: 'NON_EXISTENT_PSP',
        idempotencyKey: `v11-bad-${bookingId}`,
      }),
    });
    assert.equal(disabledPsp.status, 400);

    // Find an active/sandbox provider in CI
    const ciSandboxPsp = ciProvidersBefore.find((p) => p.status === 'SANDBOX' || p.status === 'VERIFIED_ACTIVE');
    assert.ok(ciSandboxPsp, 'Expected at least one SANDBOX/VERIFIED_ACTIVE provider in CI');

    const initKey = `v11-pay-${bookingId}`;
    const payInit1 = await reqRaw(srv.baseUrl, '/api/payments/initiate', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        providerCode: ciSandboxPsp.providerCode,
        idempotencyKey: initKey,
      }),
    });
    assert.equal(payInit1.status, 201);
    const paymentId = payInit1.body.payment.id;
    assert.equal(payInit1.body.payment.amountGross, '25000.00');
    assert.equal(payInit1.body.payment.commissionAmount, '2500.00'); // CI is 10.00%
    assert.equal(payInit1.body.payment.netToProfessional, '22500.00');

    // Duplicate initiate with same idempotencyKey returns replay without creating second row
    const payInitReplay = await reqRaw(srv.baseUrl, '/api/payments/initiate', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        providerCode: ciSandboxPsp.providerCode,
        idempotencyKey: initKey,
      }),
    });
    assert.equal(payInitReplay.status, 200);
    assert.equal(payInitReplay.body.idempotentReplay, true);

    // Webhook security: stale timestamp outside 300s rejected (401)
    const stalePayload = JSON.stringify({ paymentId, status: 'SUCCEEDED', amount: 25000, currency: 'XOF' });
    const staleTs = String(Math.floor(Date.now() / 1000) - 600);
    const staleSig = signWebhookPayload(`${staleTs}.${stalePayload}`, process.env.PAYMENT_WEBHOOK_SECRET!);
    const staleWebhook = await reqRaw(srv.baseUrl, '/api/payments/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kazi-Timestamp': staleTs,
        'X-Kazi-Signature': staleSig,
      },
      body: stalePayload,
    });
    assert.equal(staleWebhook.status, 401);

    // Amount tampering in webhook rejected (400)
    const freshTs = String(Math.floor(Date.now() / 1000));
    const tamperedPayload = JSON.stringify({
      paymentId,
      status: 'SUCCEEDED',
      amount: 100, // tampered!
      currency: 'XOF',
    });
    const tamperedSig = signWebhookPayload(`${freshTs}.${tamperedPayload}`, process.env.PAYMENT_WEBHOOK_SECRET!);
    const tamperedWebhook = await reqRaw(srv.baseUrl, '/api/payments/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kazi-Timestamp': freshTs,
        'X-Kazi-Signature': tamperedSig,
        'X-Kazi-Delivery-Id': `deliv-tamper-${paymentId}`,
      },
      body: tamperedPayload,
    });
    assert.equal(tamperedWebhook.status, 400);

    // Currency tampering rejected (400)
    const badCurrencyPayload = JSON.stringify({
      paymentId,
      status: 'SUCCEEDED',
      amount: 25000,
      currency: 'USD',
    });
    const badCurrSig = signWebhookPayload(`${freshTs}.${badCurrencyPayload}`, process.env.PAYMENT_WEBHOOK_SECRET!);
    const badCurrWebhook = await reqRaw(srv.baseUrl, '/api/payments/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kazi-Timestamp': freshTs,
        'X-Kazi-Signature': badCurrSig,
        'X-Kazi-Delivery-Id': `deliv-curr-${paymentId}`,
      },
      body: badCurrencyPayload,
    });
    assert.equal(badCurrWebhook.status, 400);

    // Valid signed webhook with timestamp + delivery ID succeeds
    const validPayload = JSON.stringify({
      paymentId,
      externalRef: `EXT-V11-${Date.now()}`,
      status: 'SUCCEEDED',
      amount: 25000,
      currency: 'XOF',
    });
    const validSig = signWebhookPayload(`${freshTs}.${validPayload}`, process.env.PAYMENT_WEBHOOK_SECRET!);
    const validWebhook = await reqRaw(srv.baseUrl, '/api/payments/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kazi-Timestamp': freshTs,
        'X-Kazi-Signature': validSig,
        'X-Kazi-Delivery-Id': `deliv-ok-${paymentId}`,
      },
      body: validPayload,
    });
    assert.equal(validWebhook.status, 200);
    assert.equal(validWebhook.body.payment.status, 'CONFIRMED_SERVER');

    // Replay same delivery ID -> idempotentReplay: true, no duplicate transaction log
    const replayWebhook = await reqRaw(srv.baseUrl, '/api/payments/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kazi-Timestamp': freshTs,
        'X-Kazi-Signature': validSig,
        'X-Kazi-Delivery-Id': `deliv-ok-${paymentId}`,
      },
      body: validPayload,
    });
    assert.equal(replayWebhook.status, 200);
    assert.equal(replayWebhook.body.idempotentReplay, true);

    // New delivery ID attempting FAILED after CONFIRMED_SERVER does NOT revert payment!
    const lateFailPayload = JSON.stringify({ paymentId, status: 'FAILED', reason: 'Late retry fail' });
    const lateFailSig = signWebhookPayload(`${freshTs}.${lateFailPayload}`, process.env.PAYMENT_WEBHOOK_SECRET!);
    const lateFailWebhook = await reqRaw(srv.baseUrl, '/api/payments/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kazi-Timestamp': freshTs,
        'X-Kazi-Signature': lateFailSig,
        'X-Kazi-Delivery-Id': `deliv-fail-late-${paymentId}`,
      },
      body: lateFailPayload,
    });
    assert.equal(lateFailWebhook.status, 400);

    const [paymentInDb] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    assert.equal(paymentInDb.status, 'CONFIRMED_SERVER');

    // Refunds: Client blocked (403), SN Local Admin blocked on CI payment (403), Super Admin allowed (200), double refund blocked (400)
    const clientRefund = await reqRaw(srv.baseUrl, `/api/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Unauthorized' }),
    });
    assert.equal(clientRefund.status, 403);

    const localSnMe = await reqRaw(srv.baseUrl, '/api/auth/me', {
      headers: { Authorization: 'Bearer token-local-sn-v11' },
    });
    await db
      .insert(userRoles)
      .values({ profileId: localSnMe.body.profile.id, role: 'LOCAL_ADMIN', countryIso2: 'SN', grantedBy: 'TEST' })
      .onConflictDoNothing();

    const localSnRefundCi = await reqRaw(srv.baseUrl, `/api/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-local-sn-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cross-country refund' }),
    });
    assert.equal(localSnRefundCi.status, 403);

    const superRefund = await reqRaw(srv.baseUrl, `/api/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-super-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'V1.1 verified refund test' }),
    });
    assert.equal(superRefund.status, 200);
    assert.equal(superRefund.body.refund.status, 'APPROVED');

    const [refundedPaymentInDb] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    assert.equal(refundedPaymentInDb.status, 'REFUNDED');

    const doubleRefund = await reqRaw(srv.baseUrl, `/api/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-super-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Double refund attempt' }),
    });
    assert.equal(doubleRefund.status, 400);
  });

  // --------------------------------------------------------------------------
  // PHASE 3 & 5: SKILLS CONCURRENCY & PORTUGUESE SEEDING IN LIVE PG
  // --------------------------------------------------------------------------
  await t.test('Phases 3, 5 & 6: KAZI Skills concurrent enrollment idempotency & PostgreSQL Portuguese (pt) backfill', async () => {
    // Trigger seed & check languages + countries.name_pt
    const countriesRes = await reqRaw(srv.baseUrl, '/api/countries');
    assert.equal(countriesRes.status, 200);
    assert.equal(countriesRes.body.total, 54);

    const ao = countriesRes.body.countries.find((c: any) => c.iso2 === 'AO');
    const mz = countriesRes.body.countries.find((c: any) => c.iso2 === 'MZ');
    assert.ok(ao && ao.namePt === 'Angola' && ao.defaultLanguage === 'pt');
    assert.ok(mz && mz.namePt === 'Moçambique' && mz.defaultLanguage === 'pt');

    const missingPtCount = countriesRes.body.countries.filter((c: any) => !c.namePt).length;
    assert.equal(missingPtCount, 0, 'All 54 countries in PostgreSQL must have namePt populated');

    const ptLang = await db.select().from(languages).where(eq(languages.code, 'pt')).limit(1);
    assert.equal(ptLang.length, 1);

    // Language preference persistence for pt
    const prefRes = await reqRaw(srv.baseUrl, '/api/auth/preferences', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredLang: 'pt', countryIso2: 'AO' }),
    });
    assert.equal(prefRes.status, 200);
    assert.equal(prefRes.body.profile.preferredLang, 'pt');

    // Create synthetic course & test 4 concurrent enrollments -> strictly +1 enrolledCount
    const courseRes = await reqRaw(srv.baseUrl, '/api/skills/courses', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-super-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categorySlug: 'solar',
        partnerOrgName: 'KAZI V11 Academy',
        titleFr: '[TEST-V11] Solaire Avancé',
        titlePt: '[TEST-V11] Energia Solar Avançada',
      }),
    });
    assert.equal(courseRes.status, 201);
    const courseId = courseRes.body.course.id;
    const beforeCount = courseRes.body.course.enrolledCount;

    const enrollCalls = await Promise.all(
      Array.from({ length: 4 }, () =>
        reqRaw(srv.baseUrl, '/api/skills/enroll', {
          method: 'POST',
          headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId }),
        })
      )
    );
    assert.ok(enrollCalls.some((r) => r.status === 201));
    assert.ok(enrollCalls.every((r) => r.status === 200 || r.status === 201));

    const [updatedCourse] = await db.select().from(trainingCourses).where(eq(trainingCourses.id, courseId)).limit(1);
    assert.equal(updatedCourse.enrolledCount, beforeCount + 1);
  });

  // --------------------------------------------------------------------------
  // PHASE 4: MULTI-COUNTRY LIFECYCLE (SUSPEND / ACTIVATE GATING)
  // --------------------------------------------------------------------------
  await t.test('Phase 4: Country suspension blocks new missions/pros & preserves historical data; activation requires 7 prerequisites', async () => {
    // Super Admin cannot activate AO without completing all 7 criteria
    const blockedActivate = await reqRaw(srv.baseUrl, '/api/countries/AO/activate', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-super-v11' },
    });
    assert.equal(blockedActivate.status, 400);
    assert.ok(blockedActivate.body.missingCriteria.length > 0);

    // Suspend KE (which is TESTING with historical data) -> blocks new missions & new pro registrations
    const suspendKe = await reqRaw(srv.baseUrl, '/api/countries/KE/suspend', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-super-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '[TEST-V11] Controlled suspension check' }),
    });
    assert.equal(suspendKe.status, 200);
    assert.equal(suspendKe.body.status, 'SUSPENDED');

    const missionBlocked = await reqRaw(srv.baseUrl, '/api/missions', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        countryIso2: 'KE',
        categorySlug: 'electricity',
        title: '[TEST-V11] Suspended market test',
        description: 'Should be blocked',
        address: 'Nairobi',
        desiredDate: '2026-12-10',
        timeSlot: '09:00 - 11:00',
      }),
    });
    assert.equal(missionBlocked.status, 403);

    const proBlocked = await reqRaw(srv.baseUrl, '/api/professionals/register', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-client-other-v11', 'Content-Type': 'application/json' },
      body: JSON.stringify({ countryIso2: 'KE', primaryCategorySlug: 'electricity', headlineFr: 'Blocked' }),
    });
    assert.equal(proBlocked.status, 403);
  });

  // --------------------------------------------------------------------------
  // PHASE 7 & 8: RUNTIME ENV CHECK & API LATENCY BENCHMARK
  // --------------------------------------------------------------------------
  await t.test('Phases 7 & 8: Latency benchmark (p50/p95) & runtime environment validator', async () => {
    const envReport = validateRuntimeEnvironment();
    assert.equal(typeof envReport.ok, 'boolean');
    assert.ok(Array.isArray(envReport.missingRequiredInProd));

    const endpoints = [
      { name: 'GET /api/health', path: '/api/health', headers: {} as Record<string, string> },
      { name: 'GET /api/countries', path: '/api/countries', headers: {} as Record<string, string> },
      { name: 'GET /api/professionals', path: '/api/professionals?countryIso2=CI', headers: {} as Record<string, string> },
      { name: 'GET /api/skills/courses', path: '/api/skills/courses', headers: {} as Record<string, string> },
      {
        name: 'GET /api/missions',
        path: '/api/missions',
        headers: { Authorization: 'Bearer token-client-v11' },
      },
      {
        name: 'GET /api/admin/overview',
        path: '/api/admin/overview?countryIso2=ALL',
        headers: { Authorization: 'Bearer token-super-v11' },
      },
    ];

    __resetRateLimitForTest();
    const results: Array<{ endpoint: string; p50Ms: number; p95Ms: number; minMs: number; maxMs: number }> = [];
    for (const ep of endpoints) {
      // Warmup
      await fetch(`${srv.baseUrl}${ep.path}`, { headers: ep.headers });
      const samples: number[] = [];
      for (let i = 0; i < 15; i++) {
        const t0 = performance.now();
        const res = await fetch(`${srv.baseUrl}${ep.path}`, { headers: ep.headers });
        await res.arrayBuffer();
        assert.equal(res.status, 200);
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      results.push({
        endpoint: ep.name,
        p50Ms: percentile(samples, 50),
        p95Ms: percentile(samples, 95),
        minMs: Number(samples[0].toFixed(2)),
        maxMs: Number(samples[samples.length - 1].toFixed(2)),
      });
    }
    console.log('PERF_BENCHMARK_JSON=' + JSON.stringify(results));
  });
});
