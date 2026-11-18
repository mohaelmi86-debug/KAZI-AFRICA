import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import { like } from 'drizzle-orm';

dotenv.config();
process.env.NODE_ENV = 'test';
process.env.KAZI_TEST_NO_LISTEN = '1';
process.env.PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'kazi-test-webhook-secret';

import { KAZI_BRAND } from '../src/config/brand.ts';
import { AFRICAN_COUNTRIES_54 } from '../src/data/africanCountries.ts';
import { TRANSLATIONS } from '../src/i18n/translations.ts';
import {
  calculateCommissionSplit,
  canTransitionBooking,
  evaluateCountryActivationReadiness,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../src/server/businessLogic.ts';
import { __setVerifyIdTokenForTest } from '../src/middleware/auth.ts';
import { db } from '../src/db/index.ts';
import { missions, profiles, userRoles } from '../src/db/schema.ts';

const { app } = await import('../server.ts');

// ============================================================================
// 1. UNIT TESTS (REFERENTIAL, STATE MACHINE, COMMISSIONS, WEBHOOKS, I18N)
// ============================================================================

test('Referential contains all 54 sovereign African countries with unique ISO codes', () => {
  assert.equal(AFRICAN_COUNTRIES_54.length, 54);
  const iso2Set = new Set(AFRICAN_COUNTRIES_54.map((c) => c.iso2));
  const iso3Set = new Set(AFRICAN_COUNTRIES_54.map((c) => c.iso3));
  assert.equal(iso2Set.size, 54);
  assert.equal(iso3Set.size, 54);
  for (const country of AFRICAN_COUNTRIES_54) {
    assert.ok(country.defaultCurrency.length >= 3);
    assert.ok(country.timezone.includes('/'));
    assert.ok(country.majorCities.length >= 1);
  }
});

test('Country activation engine enforces all 7 mandatory prerequisites', () => {
  const incomplete: any = {
    configComplete: true,
    complianceVerified: true,
    paymentsConfigured: false,
    localLeadAssigned: true,
    securityTestsPassed: true,
    functionalTestsPassed: true,
    activationAuthorized: true,
  };
  const resIncomplete = evaluateCountryActivationReadiness(incomplete);
  assert.equal(resIncomplete.canActivate, false);
  assert.deepEqual(resIncomplete.missingCriteria, ['paymentsConfigured']);

  const complete: any = { ...incomplete, paymentsConfigured: true };
  const resComplete = evaluateCountryActivationReadiness(complete);
  assert.equal(resComplete.canActivate, true);
  assert.deepEqual(resComplete.missingCriteria, []);
});

test('Booking state machine enforces valid server-side transitions only', () => {
  assert.equal(canTransitionBooking('CONFIRMED', 'IN_PROGRESS'), true);
  assert.equal(canTransitionBooking('IN_PROGRESS', 'AWAITING_CLIENT_VALIDATION'), true);
  assert.equal(canTransitionBooking('AWAITING_CLIENT_VALIDATION', 'COMPLETED'), true);
  assert.equal(canTransitionBooking('COMPLETED', 'CONFIRMED'), false);
  assert.equal(canTransitionBooking('CANCELLED', 'IN_PROGRESS'), false);
});

test('Commission calculation clamps between 8% and 12% and computes exact net split', () => {
  const split10 = calculateCommissionSplit(225, 10);
  assert.equal(split10.ratePct, '10.00');
  assert.equal(split10.commissionAmount, '22.50');
  assert.equal(split10.netToProfessional, '202.50');

  const splitClampedLow = calculateCommissionSplit(100, 3);
  assert.equal(splitClampedLow.ratePct, '8.00');
  assert.equal(splitClampedLow.commissionAmount, '8.00');

  const splitClampedHigh = calculateCommissionSplit(100, 25);
  assert.equal(splitClampedHigh.ratePct, '12.00');
  assert.equal(splitClampedHigh.commissionAmount, '12.00');
});

test('Payment webhook HMAC-SHA256 verification rejects tampered payloads', () => {
  const secret = 'test-secret-key';
  const payload = JSON.stringify({ paymentId: 'p1', status: 'SUCCEEDED' });
  const sig = signWebhookPayload(payload, secret);
  assert.equal(verifyWebhookSignature(payload, sig, secret), true);
  assert.equal(verifyWebhookSignature(payload.replace('p1', 'p2'), sig, secret), false);
});

test('Multilingual i18n dictionary provides complete recursive parity for FR, EN, PT, and AR', () => {
  function assertDeepParity(base: Record<string, any>, target: Record<string, any>, label: string, prefix = '') {
    assert.deepEqual(Object.keys(target).sort(), Object.keys(base).sort(), `Key mismatch in ${label}.${prefix}`);
    for (const k of Object.keys(base)) {
      const bVal = base[k];
      const tVal = target[k];
      if (bVal && typeof bVal === 'object') {
        assert.ok(tVal && typeof tVal === 'object', `Expected object at ${label}.${prefix}${k}`);
        assertDeepParity(bVal, tVal, label, `${prefix}${k}.`);
      } else {
        assert.ok(typeof tVal === 'string' && tVal.trim().length > 0, `Empty translation at ${label}.${prefix}${k}`);
      }
    }
  }
  assertDeepParity(TRANSLATIONS.fr, TRANSLATIONS.en, 'en');
  assertDeepParity(TRANSLATIONS.fr, TRANSLATIONS.pt, 'pt');
  assertDeepParity(TRANSLATIONS.fr, TRANSLATIONS.ar, 'ar');
  for (const iso of ['AO', 'CV', 'GW', 'MZ', 'ST']) {
    const c = AFRICAN_COUNTRIES_54.find((item) => item.iso2 === iso);
    assert.ok(c, `Missing PALOP country ${iso}`);
    assert.equal(c.defaultLanguage, 'pt', `${iso} should default to pt`);
  }
  for (const c of AFRICAN_COUNTRIES_54) {
    assert.ok(c.namePt && c.namePt.trim().length > 0, `Missing namePt for ${c.iso2}`);
  }
});

test('Official KAZI AFRICA brand configuration and all derived image assets exist', () => {
  assert.equal(KAZI_BRAND.name, 'KAZI AFRICA');
  assert.equal(KAZI_BRAND.descriptor, 'SKILLS • SERVICES • OPPORTUNITIES');
  assert.equal(KAZI_BRAND.tagline, 'African Talent Deserves Its Place.');
  for (const [key, relPath] of Object.entries(KAZI_BRAND.assets)) {
    const absPath = path.resolve(process.cwd(), 'public', relPath.replace(/^\//, ''));
    assert.ok(fs.existsSync(absPath), `Missing brand asset (${key}): ${absPath}`);
    const stat = fs.statSync(absPath);
    assert.ok(stat.size > 500, `Empty/corrupt brand asset (${key}): ${absPath}`);
  }
});

// ============================================================================
// 2. HTTP INTEGRATION TESTS (RBAC, IDOR, COUNTRY ISOLATION, SECURITY, PG)
// ============================================================================

async function startTestHttpServer() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function reqJson(baseUrl: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test('HTTP Integration: Health, 54 countries, Auth, RBAC, Local Admin isolation, IDOR & Webhook security', async (t) => {
  const srv = await startTestHttpServer();

  // Map test tokens to synthetic Firebase decoded tokens
  __setVerifyIdTokenForTest(async (token: string) => {
    if (token === 'token-client-a') {
      return { uid: 'test-audit-client-a', email: 'test-audit-client-a@kazi.test', name: 'Client A Test' } as any;
    }
    if (token === 'token-client-b') {
      return { uid: 'test-audit-client-b', email: 'test-audit-client-b@kazi.test', name: 'Client B Test' } as any;
    }
    if (token === 'token-local-sn') {
      return { uid: 'test-audit-local-sn', email: 'test-audit-local-sn@kazi.test', name: 'Local Admin SN' } as any;
    }
    if (token === 'token-super') {
      return { uid: 'test-audit-super', email: 'moha.elmi86@gmail.com', name: 'Super Admin Test' } as any;
    }
    throw new Error('Invalid test token');
  });

  t.after(async () => {
    __setVerifyIdTokenForTest(null);
    await db.delete(missions).where(like(missions.title, '[TEST-AUDIT]%'));
    await db.delete(profiles).where(like(profiles.uid, 'test-audit-%'));
    await srv.close();
    await global._postgresPool?.end();
  });

  // 1. Public health & 54-country referential
  const health = await reqJson(srv.baseUrl, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');

  const countriesRes = await reqJson(srv.baseUrl, '/api/countries');
  assert.equal(countriesRes.status, 200);
  assert.equal(countriesRes.body.total, 54);

  // 2. Unauthenticated rejection on protected endpoints
  const unauthMe = await reqJson(srv.baseUrl, '/api/auth/me');
  assert.equal(unauthMe.status, 401);
  const unauthAdmin = await reqJson(srv.baseUrl, '/api/admin/overview');
  assert.equal(unauthAdmin.status, 401);

  // 3. Provision Client A and verify RBAC blocks Admin/Country endpoints
  const clientAMe = await reqJson(srv.baseUrl, '/api/auth/me', {
    headers: { Authorization: 'Bearer token-client-a' },
  });
  assert.equal(clientAMe.status, 200);
  assert.deepEqual(clientAMe.body.roles, ['CLIENT']);

  const clientAdminAttempt = await reqJson(srv.baseUrl, '/api/admin/overview', {
    headers: { Authorization: 'Bearer token-client-a' },
  });
  assert.equal(clientAdminAttempt.status, 403);

  const clientActivateAttempt = await reqJson(srv.baseUrl, '/api/countries/KE/activate', {
    method: 'POST',
    headers: { Authorization: 'Bearer token-client-a' },
  });
  assert.equal(clientActivateAttempt.status, 403);

  // 4. Professional registration cannot self-verify even if isVerified: true is injected
  const proReg = await reqJson(srv.baseUrl, '/api/professionals/register', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-client-a',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      countryIso2: 'CI',
      primaryCategorySlug: 'electricity',
      headlineFr: 'Test Pro',
      isVerified: true,
    }),
  });
  assert.equal(proReg.status, 200);
  assert.equal(proReg.body.professional.isVerified, false);

  // 5. Invalid UUID check returns 400 (not 500)
  const badUuid = await reqJson(srv.baseUrl, '/api/professionals/not-a-valid-uuid');
  assert.equal(badUuid.status, 400);

  // 6. Create mission as Client B in CI and test IDOR protection from Client A
  const createdMission = await reqJson(srv.baseUrl, '/api/missions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-client-b',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      countryIso2: 'CI',
      categorySlug: 'electricity',
      title: '[TEST-AUDIT] Diagnostic tableau',
      description: 'Test audit IDOR isolation',
      address: 'Cocody Riviera',
      desiredDate: '2026-12-01',
      timeSlot: '09:00 - 11:00',
    }),
  });
  assert.equal(createdMission.status, 201);
  const missionId = createdMission.body.mission.id;

  // Client A (who is a pro in CI, not the owner and not target) cannot open dispute on Client B's mission
  const idorDispute = await reqJson(srv.baseUrl, '/api/disputes', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-client-a',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      missionId,
      reason: 'Unauthorized dispute attempt',
    }),
  });
  assert.equal(idorDispute.status, 403);

  // 7. Local Admin country isolation: grant LOCAL_ADMIN for SN only
  const localSnMe = await reqJson(srv.baseUrl, '/api/auth/me', {
    headers: { Authorization: 'Bearer token-local-sn' },
  });
  assert.equal(localSnMe.status, 200);
  const localSnProfileId = localSnMe.body.profile.id;

  await db
    .insert(userRoles)
    .values({
      profileId: localSnProfileId,
      role: 'LOCAL_ADMIN',
      countryIso2: 'SN',
      grantedBy: 'TEST_HARNESS',
    })
    .onConflictDoNothing();

  const localAdminCiBlocked = await reqJson(srv.baseUrl, '/api/admin/overview?countryIso2=CI', {
    headers: { Authorization: 'Bearer token-local-sn' },
  });
  assert.equal(localAdminCiBlocked.status, 403);

  const localAdminConfigCiBlocked = await reqJson(srv.baseUrl, '/api/countries/CI/config', {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer token-local-sn',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ regulatoryNotes: 'Unauthorized cross-country edit' }),
  });
  assert.equal(localAdminConfigCiBlocked.status, 403);

  const localAdminSnAllowed = await reqJson(srv.baseUrl, '/api/admin/overview?countryIso2=SN', {
    headers: { Authorization: 'Bearer token-local-sn' },
  });
  assert.equal(localAdminSnAllowed.status, 200);

  // 8. Super Admin cannot activate a PLANNED country without prerequisites
  const superActivateKe = await reqJson(srv.baseUrl, '/api/countries/KE/activate', {
    method: 'POST',
    headers: { Authorization: 'Bearer token-super' },
  });
  assert.equal(superActivateKe.status, 400);
  assert.ok(Array.isArray(superActivateKe.body.missingCriteria));
  assert.ok(superActivateKe.body.missingCriteria.length > 0);

  // 9. Webhook rejects invalid signature with 401 and accepts valid HMAC-SHA256 signature
  const badWebhook = await reqJson(srv.baseUrl, '/api/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Kazi-Signature': 'deadbeef',
    },
    body: JSON.stringify({ event: 'ping' }),
  });
  assert.equal(badWebhook.status, 401);

  const validBody = JSON.stringify({ event: 'ping', status: 'IGNORED' });
  const validSig = signWebhookPayload(validBody, process.env.PAYMENT_WEBHOOK_SECRET!);
  const goodWebhook = await reqJson(srv.baseUrl, '/api/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Kazi-Signature': validSig,
    },
    body: validBody,
  });
  assert.equal(goodWebhook.status, 200);
  assert.equal(goodWebhook.body.received, true);

  // 10. Homepage highlights, administrable FAQ, opportunities & public contact
  const highlights = await reqJson(srv.baseUrl, '/api/home/highlights');
  assert.equal(highlights.status, 200);
  assert.equal(highlights.body.countryStats.TOTAL, 54);
  assert.ok(Array.isArray(highlights.body.homeCategories));
  assert.equal(highlights.body.homeCategories.length, 12);

  const faqRes = await reqJson(srv.baseUrl, '/api/faq');
  assert.equal(faqRes.status, 200);
  assert.ok(Array.isArray(faqRes.body.items));
  assert.ok(faqRes.body.items.length >= 3);

  const clientFaqPut = await reqJson(srv.baseUrl, '/api/admin/faq', {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer token-client-a',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items: faqRes.body.items }),
  });
  assert.equal(clientFaqPut.status, 403);

  const superFaqPut = await reqJson(srv.baseUrl, '/api/admin/faq', {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer token-super',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items: faqRes.body.items }),
  });
  assert.equal(superFaqPut.status, 200);

  const oppsRes = await reqJson(srv.baseUrl, '/api/opportunities');
  assert.equal(oppsRes.status, 200);
  assert.ok(Array.isArray(oppsRes.body.opportunities));
  assert.ok(oppsRes.body.opportunities.length >= 1);

  const contactRes = await reqJson(srv.baseUrl, '/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '[TEST-AUDIT] Contact',
      email: 'contact@kazi.test',
      countryIso2: 'CI',
      subject: 'Partenariat test',
      message: 'Test contact form message.',
    }),
  });
  assert.equal(contactRes.status, 201);
  assert.equal(contactRes.body.received, true);
  assert.ok(String(contactRes.body.referenceCode).startsWith('CNT-'));
});
