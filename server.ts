import express from 'express';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { and, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { createServer as createViteServer } from 'vite';
import { getPrivateEmploymentBucket } from './src/lib/firebase-admin.ts';
import { validateRuntimeEnvironment } from './src/config/env.ts';
import { db } from './src/db/index.ts';
import { ensureDatabaseSeeded } from './src/db/seed.ts';
import {
  auditLogs,
  bookings,
  bookingStatusHistory,
  certifications,
  cities,
  countries,
  countryAdmins,
  countryDeployments,
  countryModules,
  countryPaymentProviders,
  disputes,
  enrollments,
  employerVerifications,
  employmentOffers,
  evaluations,
  jobPosts,
  candidateProfiles,
  candidateDocuments,
  candidateDocumentShares,
  jobApplications,
  jobApplicationEvents,
  jobInterviews,
  jobInterviewEvaluations,
  messages,
  missions,
  notifications,
  organizations,
  orgMembers,
  payments,
  paymentTransactions,
  platformSettings,
  professionals,
  professionalServices,
  professionalSkills,
  profiles,
  quotes,
  reviews,
  serviceCategories,
  skillPassports,
  skills,
  trainingCourses,
  userRoles,
  verifications,
} from './src/db/schema.ts';
import {
  grantUserRoleSafely,
  optionalAuth,
  rateLimit,
  requireAnyRole,
  requireAuth,
  type AppRole,
  type AuthRequest,
} from './src/middleware/auth.ts';
import {
  calculateCommissionSplit,
  canActorTransitionBooking,
  confirmPaymentServerSide,
  evaluateCountryActivationIntegrity,
  failPaymentServerSide,
  issueRefundServerSide,
  signWebhookPayload,
  transitionBookingStatus,
  verifyWebhookSignature,
} from './src/server/businessLogic.ts';
import {
  aiAnalyzeTrendsAndRisks,
  aiAssistProfileAndTranslate,
  aiDraftQuote,
  aiMatchProfessionals,
} from './src/server/geminiService.ts';

dotenv.config();

export const app = express();
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const EPHEMERAL_DEV_WEBHOOK_SECRET = crypto.randomBytes(32).toString('hex');
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || (IS_PRODUCTION ? '' : EPHEMERAL_DEV_WEBHOOK_SECRET);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function isPgUniqueViolation(err: any): boolean {
  return err?.code === '23505' || err?.cause?.code === '23505';
}

type EmploymentNotificationContent = {
  type: string;
  eventKey: string;
  titleFr: string; titleEn: string; titleAr: string; titlePt: string;
  bodyFr: string; bodyEn: string; bodyAr: string; bodyPt: string;
};

async function sendEmploymentNotification(profileId: string, content: EmploymentNotificationContent): Promise<void> {
  try {
    await db.insert(notifications).values({
      profileId,
      type: content.type,
      eventKey: `${content.eventKey}:${profileId}`,
      titleFr: content.titleFr, titleEn: content.titleEn, titleAr: content.titleAr, titlePt: content.titlePt,
      bodyFr: content.bodyFr, bodyEn: content.bodyEn, bodyAr: content.bodyAr, bodyPt: content.bodyPt,
    }).onConflictDoNothing({ target: notifications.eventKey });
  } catch (err) {
    console.error('Employment notification delivery failed:', err);
  }
}

async function notifyEmploymentOrganization(organizationId: string, content: EmploymentNotificationContent): Promise<void> {
  try {
    const [organization] = await db.select({ ownerProfileId: organizations.ownerProfileId })
      .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!organization) return;
    const members = await db.select({ profileId: orgMembers.profileId })
      .from(orgMembers)
      .where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.isActive, true)));
    const recipients = [...new Set([organization.ownerProfileId, ...members.map((member) => member.profileId)])];
    await Promise.all(recipients.map((profileId) => sendEmploymentNotification(profileId, content)));
  } catch (err) {
    console.error('Employment organization notification failed:', err);
  }
}

async function notifyEmploymentCandidate(candidateProfileId: string, content: EmploymentNotificationContent): Promise<void> {
  try {
    const [candidate] = await db.select({ profileId: candidateProfiles.profileId })
      .from(candidateProfiles).where(eq(candidateProfiles.id, candidateProfileId)).limit(1);
    if (candidate) await sendEmploymentNotification(candidate.profileId, content);
  } catch (err) {
    console.error('Employment candidate notification failed:', err);
  }
}

const webhookReplayCache = new Map<string, number>();
const WEBHOOK_REPLAY_TTL_MS = 10 * 60 * 1000;
const PUBLIC_CACHEABLE_GET_PATHS = new Set([
  '/api/health',
  '/api/countries',
  '/api/categories',
  '/api/professionals',
  '/api/skills/courses',
  '/api/home/highlights',
  '/api/faq',
  '/api/opportunities',
]);

function parseAllowedOrigins(): Set<string> {
  const list = [
    process.env.APP_URL || '',
    ...(process.env.CORS_ALLOWED_ORIGINS || '').split(','),
  ]
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return new Set(list);
}

type RawBodyRequest = express.Request & { rawBody?: string };

// Request ID + structured JSON request logging on /api
app.use((req, res, next) => {
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  (req as AuthRequest).requestId = reqId;
  res.setHeader('X-Request-Id', reqId);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path.startsWith('/api') || res.statusCode >= 500) {
      const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      if (process.env.NODE_ENV !== 'test') {
        console.log(
          JSON.stringify({
            level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
            requestId: reqId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            latencyMs: Number(latencyMs.toFixed(2)),
          })
        );
      }
    }
  });
  next();
});

app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = buf.toString('utf8');
    },
  })
);

// Explicit CORS policy & security headers
app.use((req, res, next) => {
  const origin = req.headers.origin ? String(req.headers.origin).replace(/\/+$/, '') : '';
  const allowedOrigins = parseAllowedOrigins();
  const isAllowedOrigin =
    !origin ||
    allowedOrigins.has(origin) ||
    (!IS_PRODUCTION &&
      (origin.endsWith('.run.app') || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)));

  if (origin && isAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization,Content-Type,X-Kazi-Signature,X-Kazi-Timestamp,X-Kazi-Delivery-Id,X-Request-Id'
    );
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (req.path.startsWith('/api')) {
    const isPublicGet = req.method === 'GET' && PUBLIC_CACHEABLE_GET_PATHS.has(req.path);
    if (!isPublicGet) {
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('Pragma', 'no-cache');
    }
  }

  if (req.method === 'OPTIONS') {
    return res.status(isAllowedOrigin ? 204 : 403).end();
  }
  return next();
});

const aiRateLimit = rateLimit(20, 60_000);
app.use('/api', rateLimit(180, 60_000));

// Lazy idempotent seed middleware on API calls (no eager startup probe)
app.use('/api', async (_req, res, next) => {
  try {
    await ensureDatabaseSeeded();
    next();
  } catch (err) {
    console.error('Database initialization error:', err);
    res.status(503).json({ error: 'Database service temporarily unavailable' });
  }
});

// ============================================================================
// 1. HEALTH & AUTH
// ============================================================================

app.get('/api/health', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({
      status: 'ok',
      service: 'kazi-africa-core',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Health check DB probe failed:', err);
    res.status(503).json({
      status: 'degraded',
      service: 'kazi-africa-core',
      database: 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, ctx.profileId)).limit(1);
    res.json({
      profile,
      roles: ctx.roles,
      activeRole: ctx.activeRole,
      adminCountryIso2s: ctx.adminCountryIso2s,
    });
  } catch (err) {
    console.error('Error fetching auth context:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

app.post('/api/auth/active-role', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const requestedRole = String(req.body?.role || '');
    if (!ctx.roles.includes(requestedRole as typeof ctx.roles[number])) {
      return res.status(403).json({ error: 'Role not granted to this account' });
    }
    await db
      .update(profiles)
      .set({ activeRole: requestedRole, updatedAt: new Date() })
      .where(eq(profiles.id, ctx.profileId));
    res.json({ activeRole: requestedRole });
  } catch (err) {
    console.error('Error switching role:', err);
    res.status(500).json({ error: 'Failed to update active role' });
  }
});

app.patch('/api/auth/preferences', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const { preferredLang, countryIso2, cityName } = req.body || {};
    const updates: Partial<typeof profiles.$inferInsert> = { updatedAt: new Date() };
    if (preferredLang && ['fr', 'en', 'pt', 'ar'].includes(preferredLang)) {
      updates.preferredLang = preferredLang;
    }
    if (countryIso2 && typeof countryIso2 === 'string' && countryIso2.length === 2) {
      const normalizedIso = countryIso2.toUpperCase();
      const [validCountry] = await db
        .select({ id: countries.id })
        .from(countries)
        .where(eq(countries.iso2, normalizedIso))
        .limit(1);
      if (!validCountry) {
        return res.status(400).json({ error: 'Invalid country ISO2 code' });
      }
      updates.countryIso2 = normalizedIso;
    }
    if (cityName && typeof cityName === 'string') {
      updates.cityName = cityName.slice(0, 80);
    }
    const [updated] = await db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.id, ctx.profileId))
      .returning();
    res.json({ profile: updated });
  } catch (err) {
    console.error('Error updating preferences:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// ============================================================================
// 2. 54-COUNTRY REFERENTIAL & ACTIVATION ENGINE
// ============================================================================

app.get('/api/countries', async (_req, res) => {
  try {
    const allCountries = await db.select().from(countries).orderBy(countries.nameFr);
    const deployments = await db.select().from(countryDeployments);
    const providers = await db.select().from(countryPaymentProviders);
    const allCities = await db.select().from(cities);
    const modules = await db.select().from(countryModules);

    const depMap = new Map(deployments.map((d) => [d.countryId, d]));
    const enriched = allCountries.map((c) => {
      const deployment = depMap.get(c.id) || null;
      const countryProviders = providers.filter((p) => p.countryId === c.id);
      const countryCities = allCities.filter((ct) => ct.countryId === c.id);
      const configuredProvidersCount = countryProviders.filter(
        (p) => p.status === 'VERIFIED_ACTIVE' || p.status === 'SANDBOX'
      ).length;
      return {
        ...c,
        deployment,
        readiness: deployment
          ? evaluateCountryActivationIntegrity({
              country: c,
              deployment,
              citiesCount: countryCities.filter((ct) => ct.isActive).length,
              configuredProvidersCount,
            })
          : { canActivate: false, missingCriteria: ['configComplete'] },
        paymentProviders: countryProviders,
        cities: countryCities,
        modules: modules.filter((m) => m.countryId === c.id),
      };
    });

    res.json({ countries: enriched, total: enriched.length });
  } catch (err) {
    console.error('Error loading countries:', err);
    res.status(500).json({ error: 'Failed to load African countries referential' });
  }
});

app.patch(
  '/api/countries/:iso2/config',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN', 'LOCAL_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const iso2 = req.params.iso2.toUpperCase();
      const isSuperAdmin = ctx.roles.includes('SUPER_ADMIN');

      if (!isSuperAdmin && !ctx.adminCountryIso2s.includes(iso2)) {
        return res.status(403).json({ error: 'Local admin access denied for this country' });
      }

      const [country] = await db.select().from(countries).where(eq(countries.iso2, iso2)).limit(1);
      if (!country) return res.status(404).json({ error: 'Country not found' });

      const {
        commissionRatePct,
        taxRatePct,
        regulatoryNotes,
        proSubscriptionMonthly,
        enterpriseSubscriptionMonthly,
        operatorLicenseMonthly,
        checklist,
      } = req.body || {};

      const countryUpdates: Partial<typeof countries.$inferInsert> = { updatedAt: new Date() };
      if (isSuperAdmin && commissionRatePct !== undefined) {
        const rate = Number(commissionRatePct);
        if (!Number.isFinite(rate) || rate < 8 || rate > 12) {
          return res.status(400).json({ error: 'Commission rate must be between 8% and 12%' });
        }
        countryUpdates.commissionRatePct = rate.toFixed(2);
      }
      if (taxRatePct !== undefined) {
        const tax = Number(taxRatePct);
        if (!Number.isFinite(tax) || tax < 0 || tax > 40) {
          return res.status(400).json({ error: 'Tax rate must be between 0% and 40%' });
        }
        countryUpdates.taxRatePct = tax.toFixed(2);
      }
      if (typeof regulatoryNotes === 'string') {
        countryUpdates.regulatoryNotes = regulatoryNotes.slice(0, 1000);
      }
      if (isSuperAdmin && proSubscriptionMonthly !== undefined) {
        const fee = Number(proSubscriptionMonthly);
        if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ error: 'Invalid Pro subscription fee' });
        countryUpdates.proSubscriptionMonthly = fee.toFixed(2);
      }
      if (isSuperAdmin && enterpriseSubscriptionMonthly !== undefined) {
        const fee = Number(enterpriseSubscriptionMonthly);
        if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ error: 'Invalid Enterprise subscription fee' });
        countryUpdates.enterpriseSubscriptionMonthly = fee.toFixed(2);
      }
      if (isSuperAdmin && operatorLicenseMonthly !== undefined) {
        const fee = Number(operatorLicenseMonthly);
        if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ error: 'Invalid Operator license fee' });
        countryUpdates.operatorLicenseMonthly = fee.toFixed(2);
      }

      if (country.status === 'PLANNED') {
        countryUpdates.status = 'CONFIGURING';
      }

      await db.update(countries).set(countryUpdates).where(eq(countries.id, country.id));

      if (checklist && typeof checklist === 'object') {
        const checklistEntries: Array<[keyof typeof checklist, unknown]> = Object.entries(checklist) as Array<
          [keyof typeof checklist, unknown]
        >;
        if (
          country.status === 'ACTIVE' &&
          checklistEntries.some(([, val]) => val === false)
        ) {
          return res.status(400).json({
            error: 'Cannot revoke activation prerequisites while market is ACTIVE; suspend market first',
          });
        }

        const depUpdates: Partial<typeof countryDeployments.$inferInsert> = { updatedAt: new Date() };
        if (typeof checklist.configComplete === 'boolean') depUpdates.configComplete = checklist.configComplete;
        if (typeof checklist.complianceVerified === 'boolean') depUpdates.complianceVerified = checklist.complianceVerified;
        if (typeof checklist.paymentsConfigured === 'boolean') depUpdates.paymentsConfigured = checklist.paymentsConfigured;
        if (typeof checklist.localLeadAssigned === 'boolean') depUpdates.localLeadAssigned = checklist.localLeadAssigned;
        if (typeof checklist.securityTestsPassed === 'boolean') depUpdates.securityTestsPassed = checklist.securityTestsPassed;
        if (typeof checklist.functionalTestsPassed === 'boolean') depUpdates.functionalTestsPassed = checklist.functionalTestsPassed;
        if (isSuperAdmin && typeof checklist.activationAuthorized === 'boolean') {
          depUpdates.activationAuthorized = checklist.activationAuthorized;
        }
        await db.update(countryDeployments).set(depUpdates).where(eq(countryDeployments.countryId, country.id));
      }

      await db.insert(auditLogs).values({
        actorProfileId: ctx.profileId,
        actorUid: ctx.uid,
        actorRole: isSuperAdmin ? 'SUPER_ADMIN' : 'LOCAL_ADMIN',
        countryIso2: iso2,
        action: 'COUNTRY_CONFIG_UPDATED',
        entityType: 'country',
        entityId: country.id,
        details: { iso2 },
      });

      res.json({ success: true });
    } catch (err) {
      console.error('Error updating country config:', err);
      res.status(500).json({ error: 'Failed to update country configuration' });
    }
  }
);

app.patch(
  '/api/countries/:iso2/providers/:providerCode',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const iso2 = req.params.iso2.toUpperCase();
      const providerCode = String(req.params.providerCode);
      const { status, verificationNote, supportsEscrow } = req.body || {};

      if (!['UNVERIFIED', 'SANDBOX', 'VERIFIED_ACTIVE', 'DISABLED'].includes(String(status))) {
        return res.status(400).json({ error: 'Invalid provider status' });
      }

      const [country] = await db.select().from(countries).where(eq(countries.iso2, iso2)).limit(1);
      if (!country) return res.status(404).json({ error: 'Country not found' });

      const [provider] = await db
        .select()
        .from(countryPaymentProviders)
        .where(
          and(
            eq(countryPaymentProviders.countryId, country.id),
            eq(countryPaymentProviders.providerCode, providerCode)
          )
        )
        .limit(1);

      if (!provider) return res.status(404).json({ error: 'Payment provider not found for country' });

      const [updated] = await db
        .update(countryPaymentProviders)
        .set({
          status: String(status),
          verificationNote: verificationNote
            ? String(verificationNote).slice(0, 300)
            : provider.verificationNote,
          supportsEscrow: typeof supportsEscrow === 'boolean' ? supportsEscrow : provider.supportsEscrow,
          updatedAt: new Date(),
        })
        .where(eq(countryPaymentProviders.id, provider.id))
        .returning();

      await db.insert(auditLogs).values({
        actorProfileId: ctx.profileId,
        actorUid: ctx.uid,
        actorRole: 'SUPER_ADMIN',
        countryIso2: iso2,
        action: 'PAYMENT_PROVIDER_UPDATED',
        entityType: 'country_payment_provider',
        entityId: provider.id,
        details: { iso2, providerCode, status: updated.status },
      });

      res.json({ provider: updated });
    } catch (err) {
      console.error('Error updating provider:', err);
      res.status(500).json({ error: 'Failed to update payment provider' });
    }
  }
);

app.post(
  '/api/countries/:iso2/activate',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const iso2 = req.params.iso2.toUpperCase();
      const [country] = await db.select().from(countries).where(eq(countries.iso2, iso2)).limit(1);
      if (!country) return res.status(404).json({ error: 'Country not found' });

      const [dep] = await db
        .select()
        .from(countryDeployments)
        .where(eq(countryDeployments.countryId, country.id))
        .limit(1);

      if (!dep) return res.status(400).json({ error: 'Country deployment record missing' });

      const countryCities = await db.select().from(cities).where(eq(cities.countryId, country.id));
      const countryProviders = await db
        .select()
        .from(countryPaymentProviders)
        .where(eq(countryPaymentProviders.countryId, country.id));

      const readiness = evaluateCountryActivationIntegrity({
        country,
        deployment: dep,
        citiesCount: countryCities.filter((ct) => ct.isActive).length,
        configuredProvidersCount: countryProviders.filter(
          (p) => p.status === 'VERIFIED_ACTIVE' || p.status === 'SANDBOX'
        ).length,
      });
      if (!readiness.canActivate) {
        return res.status(400).json({
          error: 'Activation blocked: prerequisite checks incomplete',
          missingCriteria: readiness.missingCriteria,
        });
      }

      await db
        .update(countries)
        .set({ status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(countries.id, country.id));

      await db
        .update(countryDeployments)
        .set({
          registrationsOpen: true,
          missionsOpen: true,
          suspensionReason: null,
          activatedByUid: ctx.uid,
          activatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(countryDeployments.countryId, country.id));

      await db.insert(auditLogs).values({
        actorProfileId: ctx.profileId,
        actorUid: ctx.uid,
        actorRole: 'SUPER_ADMIN',
        countryIso2: iso2,
        action: 'COUNTRY_ACTIVATED',
        entityType: 'country',
        entityId: country.id,
        details: { iso2 },
      });

      res.json({ success: true, status: 'ACTIVE' });
    } catch (err) {
      console.error('Error activating country:', err);
      res.status(500).json({ error: 'Failed to activate country market' });
    }
  }
);

app.post(
  '/api/countries/:iso2/suspend',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const iso2 = req.params.iso2.toUpperCase();
      const reason = String(req.body?.reason || 'Controlled administrative suspension').slice(0, 500);
      const [country] = await db.select().from(countries).where(eq(countries.iso2, iso2)).limit(1);
      if (!country) return res.status(404).json({ error: 'Country not found' });

      await db
        .update(countries)
        .set({ status: 'SUSPENDED', updatedAt: new Date() })
        .where(eq(countries.id, country.id));

      await db
        .update(countryDeployments)
        .set({
          registrationsOpen: false,
          missionsOpen: false,
          suspensionReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(countryDeployments.countryId, country.id));

      await db.insert(auditLogs).values({
        actorProfileId: ctx.profileId,
        actorUid: ctx.uid,
        actorRole: 'SUPER_ADMIN',
        countryIso2: iso2,
        action: 'COUNTRY_SUSPENDED',
        entityType: 'country',
        entityId: country.id,
        details: { iso2, reason },
      });

      res.json({ success: true, status: 'SUSPENDED' });
    } catch (err) {
      console.error('Error suspending country:', err);
      res.status(500).json({ error: 'Failed to suspend country market' });
    }
  }
);

// ============================================================================
// 3. CATEGORIES & PROFESSIONALS
// ============================================================================

app.get('/api/categories', async (_req, res) => {
  try {
    const rows = await db.select().from(serviceCategories).orderBy(serviceCategories.sortOrder);
    res.json({ categories: rows });
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.get('/api/home/highlights', async (_req, res) => {
  try {
    const allCountries = await db.select().from(countries);
    const allPros = await db.select().from(professionals);
    const allCourses = await db.select().from(trainingCourses);
    const openMissions = await db
      .select()
      .from(missions)
      .where(inArray(missions.status, ['REQUESTED', 'QUOTED']));

    const realReviews = await db
      .select({
        review: reviews,
        authorName: profiles.fullName,
        authorCity: profiles.cityName,
        authorCountry: profiles.countryIso2,
      })
      .from(reviews)
      .innerJoin(profiles, eq(reviews.authorProfileId, profiles.id))
      .orderBy(desc(reviews.createdAt))
      .limit(12);

    const proProfileRows = allPros.length
      ? await db
          .select({ id: profiles.id, fullName: profiles.fullName })
          .from(profiles)
          .where(
            inArray(
              profiles.id,
              allPros.map((p) => p.profileId)
            )
          )
      : [];
    const profileNameMap = new Map(proProfileRows.map((p) => [p.id, p.fullName]));
    const proNameById = new Map(
      allPros.map((p) => [p.id, profileNameMap.get(p.profileId) || null])
    );

    const [catSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'home_categories'))
      .limit(1);

    const homeCategories = Array.isArray((catSetting?.value as any)?.items)
      ? ((catSetting!.value as any).items as any[])
          .filter((item) => item && item.enabled !== false)
          .sort((a, b) => Number(a.sortOrder ?? 99) - Number(b.sortOrder ?? 99))
      : [];

    const countryStatusCounts = {
      ACTIVE: allCountries.filter((c) => c.status === 'ACTIVE').length,
      TESTING: allCountries.filter((c) => c.status === 'TESTING').length,
      CONFIGURING: allCountries.filter((c) => c.status === 'CONFIGURING').length,
      PLANNED: allCountries.filter((c) => c.status === 'PLANNED').length,
      SUSPENDED: allCountries.filter((c) => c.status === 'SUSPENDED').length,
      TOTAL: allCountries.length,
    };

    const testimonials = realReviews.map((rv) => {
      const parts = String(rv.authorName || 'Client').trim().split(/\s+/);
      const safeName =
        parts.length > 1
          ? `${parts[0]} ${parts[parts.length - 1][0]?.toUpperCase() || ''}.`
          : parts[0];
      return {
        id: rv.review.id,
        authorDisplayName: safeName,
        rating: rv.review.rating,
        comment: rv.review.comment,
        city: rv.authorCity,
        countryIso2: rv.authorCountry,
        professionalName: proNameById.get(rv.review.professionalId) || null,
        createdAt: rv.review.createdAt,
        isVerifiedReview: true,
      };
    });

    res.json({
      homeCategories,
      testimonials,
      countryStats: countryStatusCounts,
      metrics: {
        professionalsCount: allPros.length,
        verifiedProfessionalsCount: allPros.filter((p) => p.isVerified).length,
        coursesCount: allCourses.filter((c) => c.status === 'PUBLISHED').length,
        openMissionsCount: openMissions.length,
      },
    });
  } catch (err) {
    console.error('Error fetching home highlights:', err);
    res.status(500).json({ error: 'Failed to load homepage highlights' });
  }
});

app.get('/api/faq', async (_req, res) => {
  try {
    const [faqSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'home_faq'))
      .limit(1);
    const items = Array.isArray((faqSetting?.value as any)?.items)
      ? ((faqSetting!.value as any).items as any[])
          .filter((item) => item && item.enabled !== false)
          .sort((a, b) => Number(a.sortOrder ?? 99) - Number(b.sortOrder ?? 99))
      : [];
    res.json({ items });
  } catch (err) {
    console.error('Error fetching FAQ:', err);
    res.status(500).json({ error: 'Failed to load FAQ' });
  }
});

app.put(
  '/api/admin/faq',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const items = req.body?.items;
      if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
        return res.status(400).json({ error: 'items must be a non-empty array (max 30)' });
      }
      const sanitized = items.map((item: any, idx: number) => ({
        id: String(item.id || `faq-${idx + 1}`).slice(0, 64),
        category: String(item.category || 'general').slice(0, 40),
        questionFr: String(item.questionFr || '').slice(0, 240),
        questionEn: String(item.questionEn || item.questionFr || '').slice(0, 240),
        questionPt: String(item.questionPt || item.questionEn || item.questionFr || '').slice(0, 240),
        questionAr: String(item.questionAr || item.questionFr || '').slice(0, 240),
        answerFr: String(item.answerFr || '').slice(0, 1200),
        answerEn: String(item.answerEn || item.answerFr || '').slice(0, 1200),
        answerPt: String(item.answerPt || item.answerEn || item.answerFr || '').slice(0, 1200),
        answerAr: String(item.answerAr || item.answerFr || '').slice(0, 1200),
        enabled: item.enabled !== false,
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : idx + 1,
      }));
      if (sanitized.some((s) => !s.questionFr || !s.answerFr)) {
        return res.status(400).json({ error: 'Each FAQ item requires questionFr and answerFr' });
      }

      await db
        .insert(platformSettings)
        .values({
          key: 'home_faq',
          value: { items: sanitized },
          updatedByUid: ctx.uid,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: {
            value: { items: sanitized },
            updatedByUid: ctx.uid,
            updatedAt: new Date(),
          },
        });

      await db.insert(auditLogs).values({
        actorProfileId: ctx.profileId,
        actorUid: ctx.uid,
        actorRole: 'SUPER_ADMIN',
        action: 'HOME_FAQ_UPDATED',
        entityType: 'platform_settings',
        entityId: 'home_faq',
        details: { count: sanitized.length },
      });

      res.json({ items: sanitized });
    } catch (err) {
      console.error('Error updating FAQ:', err);
      res.status(500).json({ error: 'Failed to update FAQ' });
    }
  }
);

app.put(
  '/api/admin/home-categories',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const items = req.body?.items;
      if (!Array.isArray(items) || items.length === 0 || items.length > 24) {
        return res.status(400).json({ error: 'items must be a non-empty array (max 24)' });
      }
      const sanitized = items.map((item: any, idx: number) => ({
        slug: String(item.slug || `cat_${idx + 1}`).slice(0, 64),
        iconName: String(item.iconName || 'Briefcase').slice(0, 40),
        nameFr: String(item.nameFr || '').slice(0, 100),
        nameEn: String(item.nameEn || item.nameFr || '').slice(0, 100),
        namePt: String(item.namePt || item.nameEn || item.nameFr || '').slice(0, 100),
        nameAr: String(item.nameAr || item.nameFr || '').slice(0, 100),
        mappedSlugs: Array.isArray(item.mappedSlugs)
          ? item.mappedSlugs.map((s: unknown) => String(s).slice(0, 60)).slice(0, 10)
          : ['electricity'],
        enabled: item.enabled !== false,
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : idx + 1,
      }));
      if (sanitized.some((s) => !s.nameFr)) {
        return res.status(400).json({ error: 'Each category requires nameFr' });
      }

      await db
        .insert(platformSettings)
        .values({
          key: 'home_categories',
          value: { items: sanitized },
          updatedByUid: ctx.uid,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: {
            value: { items: sanitized },
            updatedByUid: ctx.uid,
            updatedAt: new Date(),
          },
        });

      await db.insert(auditLogs).values({
        actorProfileId: ctx.profileId,
        actorUid: ctx.uid,
        actorRole: 'SUPER_ADMIN',
        action: 'HOME_CATEGORIES_UPDATED',
        entityType: 'platform_settings',
        entityId: 'home_categories',
        details: { count: sanitized.length },
      });

      res.json({ items: sanitized });
    } catch (err) {
      console.error('Error updating home categories:', err);
      res.status(500).json({ error: 'Failed to update home categories' });
    }
  }
);


/* ============================================================================
 * EMPLOYMENT OS — offres d'emploi et candidatures
 * Le recrutement salarié reste séparé des missions de prestation.
 * L'activation est contrôlée par pays via country_modules.module_key='employment'.
 * ========================================================================== */
async function isEmploymentEnabled(countryId: string): Promise<boolean> {
  const [module] = await db.select({ enabled: countryModules.enabled })
    .from(countryModules)
    .where(and(
      eq(countryModules.countryId, countryId),
      eq(countryModules.moduleKey, 'employment')
    ))
    .limit(1);
  return module?.enabled === true;
}

async function canManageEmploymentOrg(organizationId: string, profileId: string, roles: string[]) {
  if (roles.includes('SUPER_ADMIN')) return true;
  const [org] = await db.select().from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return false;
  if (org.ownerProfileId === profileId) return true;
  const [member] = await db.select().from(orgMembers).where(and(
    eq(orgMembers.organizationId, organizationId),
    eq(orgMembers.profileId, profileId),
    eq(orgMembers.isActive, true)
  )).limit(1);
  return !!member && ['OWNER', 'MANAGER', 'HR_ADMIN', 'RECRUITER'].includes(member.memberRole);
}


app.get('/api/employment/employer/verification', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const organizationId = String(req.query.organizationId || '');
    if (!isValidUuid(organizationId)) return res.status(400).json({ error: 'Invalid organization ID' });
    if (!(await canManageEmploymentOrg(organizationId, ctx.profileId, ctx.roles))) return res.status(403).json({ error: 'Access denied' });
    const [verification] = await db.select({
      id: employerVerifications.id, legalName: employerVerifications.legalName,
      registrationNumber: employerVerifications.registrationNumber, contactName: employerVerifications.contactName,
      contactEmail: employerVerifications.contactEmail, status: employerVerifications.status,
      submittedAt: employerVerifications.submittedAt, reviewedAt: employerVerifications.reviewedAt,
      reviewNote: employerVerifications.reviewNote,
    }).from(employerVerifications).where(eq(employerVerifications.organizationId, organizationId)).limit(1);
    res.json({ verification: verification || null });
  } catch (err) {
    console.error('Employer verification read error:', err);
    res.status(500).json({ error: 'Unable to load employer verification' });
  }
});

app.post('/api/employment/employer/verification', requireAuth, rateLimit(8, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const body = req.body || {};
    const organizationId = String(body.organizationId || '');
    const legalName = String(body.legalName || '').trim().slice(0, 180);
    const registrationNumber = String(body.registrationNumber || '').trim().slice(0, 100);
    const contactName = String(body.contactName || '').trim().slice(0, 120);
    const contactEmail = String(body.contactEmail || '').trim().toLowerCase().slice(0, 254);
    if (!isValidUuid(organizationId) || legalName.length < 2 || registrationNumber.length < 3 ||
        contactName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return res.status(400).json({ error: 'Legal name, registration number and valid contact details are required' });
    }
    if (!(await canManageEmploymentOrg(organizationId, ctx.profileId, ctx.roles))) return res.status(403).json({ error: 'Access denied' });
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const [existing] = await db.select().from(employerVerifications)
      .where(eq(employerVerifications.organizationId, organizationId)).limit(1);
    if (existing?.status === 'VERIFIED') return res.status(409).json({ error: 'This organization is already verified' });
    const values = {
      legalName, registrationNumber, contactName, contactEmail, status: 'PENDING',
      submittedAt: new Date(), reviewedByProfileId: null, reviewedAt: null, reviewNote: null, updatedAt: new Date(),
    };
    const [verification] = existing
      ? await db.update(employerVerifications).set(values).where(eq(employerVerifications.id, existing.id)).returning()
      : await db.insert(employerVerifications).values({ organizationId, ...values }).returning();
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: org.countryId ? (await db.select({ iso2: countries.iso2 }).from(countries).where(eq(countries.id, org.countryId)).limit(1))[0]?.iso2 : null,
      action: 'EMPLOYMENT_EMPLOYER_VERIFICATION_SUBMITTED', entityType: 'employer_verification',
      entityId: verification.id, details: { organizationId, status: 'PENDING' },
    });
    res.status(201).json({ verification });
  } catch (err) {
    console.error('Employer verification submit error:', err);
    res.status(500).json({ error: 'Unable to submit employer verification' });
  }
});

app.get('/api/employment/admin/employer-verifications', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const isSuperAdmin = ctx.roles.includes('SUPER_ADMIN');
    if (!isSuperAdmin && !ctx.roles.includes('LOCAL_ADMIN')) return res.status(403).json({ error: 'Admin access required' });
    const rows = await db.select({
      id: employerVerifications.id, organizationId: employerVerifications.organizationId,
      legalName: employerVerifications.legalName, registrationNumber: employerVerifications.registrationNumber,
      contactName: employerVerifications.contactName, contactEmail: employerVerifications.contactEmail,
      status: employerVerifications.status, submittedAt: employerVerifications.submittedAt,
      countryIso2: countries.iso2, organizationName: organizations.name,
    }).from(employerVerifications)
      .innerJoin(organizations, eq(employerVerifications.organizationId, organizations.id))
      .innerJoin(countries, eq(organizations.countryId, countries.id))
      .where(isSuperAdmin ? undefined : inArray(countries.iso2, ctx.adminCountryIso2s.length ? ctx.adminCountryIso2s : ['__NO_COUNTRY__']))
      .orderBy(desc(employerVerifications.submittedAt)).limit(100);
    res.json({ verifications: rows });
  } catch (err) {
    console.error('Employer verification queue error:', err);
    res.status(500).json({ error: 'Unable to load verification queue' });
  }
});

app.patch('/api/employment/admin/employer-verifications/:id', requireAuth, rateLimit(30, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const id = String(req.params.id);
    if (!isValidUuid(id)) return res.status(400).json({ error: 'Invalid verification ID' });
    const action = String(req.body?.action || '').toUpperCase();
    const note = String(req.body?.note || '').trim().slice(0, 2000);
    const evidenceReference = String(req.body?.evidenceReference || '').trim().slice(0, 300);
    if (!['VERIFY', 'REJECT', 'REQUEST_INFO'].includes(action)) return res.status(400).json({ error: 'Invalid review action' });
    if (action === 'VERIFY' && evidenceReference.length < 5) return res.status(400).json({ error: 'An official registry or document evidence reference is required to verify an employer' });
    const [record] = await db.select().from(employerVerifications).where(eq(employerVerifications.id, id)).limit(1);
    if (!record) return res.status(404).json({ error: 'Verification not found' });
    const [org] = await db.select().from(organizations).where(eq(organizations.id, record.organizationId)).limit(1);
    const [country] = org ? await db.select().from(countries).where(eq(countries.id, org.countryId)).limit(1) : [undefined];
    const isSuperAdmin = ctx.roles.includes('SUPER_ADMIN');
    if (!isSuperAdmin && (!ctx.roles.includes('LOCAL_ADMIN') || !country || !ctx.adminCountryIso2s.includes(country.iso2))) {
      return res.status(403).json({ error: 'Country-scoped admin access denied' });
    }
    const status = action === 'VERIFY' ? 'VERIFIED' : action === 'REJECT' ? 'REJECTED' : 'MORE_INFO_REQUIRED';
    const [updated] = await db.update(employerVerifications).set({
      status, reviewNote: note || null, reviewEvidenceReference: action === 'VERIFY' ? evidenceReference : null, reviewedByProfileId: ctx.profileId, reviewedAt: new Date(), updatedAt: new Date(),
    }).where(eq(employerVerifications.id, id)).returning();
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: country?.iso2 || null, action: 'EMPLOYMENT_EMPLOYER_VERIFICATION_REVIEWED',
      entityType: 'employer_verification', entityId: id, details: { organizationId: record.organizationId, status },
    });
    res.json({ verification: updated });
  } catch (err) {
    console.error('Employer verification review error:', err);
    res.status(500).json({ error: 'Unable to review employer verification' });
  }
});


app.get('/api/employment/jobs', rateLimit(90, 60_000), async (req, res) => {
  try {
    const countryIso2 = req.query.countryIso2 ? String(req.query.countryIso2).toUpperCase() : null;
    const q = req.query.q ? String(req.query.q).trim().slice(0, 100) : '';
    const city = req.query.city ? String(req.query.city).trim().slice(0, 80) : '';
    const requestedContract = req.query.contractType ? String(req.query.contractType).toUpperCase() : '';
    const requestedWorkMode = req.query.workMode ? String(req.query.workMode).toUpperCase() : '';
    const allowedContracts = new Set(['PERMANENT', 'FIXED_TERM', 'TEMPORARY', 'PART_TIME', 'INTERNSHIP', 'APPRENTICESHIP', 'SEASONAL', 'GRADUATE', 'PUBLIC_SERVICE']);
    const allowedWorkModes = new Set(['ONSITE', 'HYBRID', 'REMOTE']);
    const contractType = allowedContracts.has(requestedContract) ? requestedContract : null;
    const workMode = allowedWorkModes.has(requestedWorkMode) ? requestedWorkMode : null;
    const now = new Date();
    const rows = await db.select({
      id: jobPosts.id,
      referenceCode: jobPosts.referenceCode,
      title: jobPosts.title,
      description: jobPosts.description,
      contractType: jobPosts.contractType,
      workMode: jobPosts.workMode,
      city: jobPosts.city,
      salaryMin: jobPosts.salaryMin,
      salaryMax: jobPosts.salaryMax,
      salaryCurrency: jobPosts.salaryCurrency,
      salaryPeriod: jobPosts.salaryPeriod,
      experienceLevel: jobPosts.experienceLevel,
      requiredSkills: jobPosts.requiredSkills,
      applicationDeadline: jobPosts.applicationDeadline,
      publishedAt: jobPosts.publishedAt,
      organizationName: organizations.name,
      countryIso2: countries.iso2,
      countryName: countries.nameFr,
    }).from(jobPosts)
      .innerJoin(organizations, eq(jobPosts.organizationId, organizations.id))
      .innerJoin(countries, eq(jobPosts.countryId, countries.id))
      .innerJoin(countryModules, and(
        eq(countryModules.countryId, countries.id),
        eq(countryModules.moduleKey, 'employment'),
        eq(countryModules.enabled, true)
      ))
      .where(and(
        eq(jobPosts.status, 'PUBLISHED'),
        eq(countries.status, 'ACTIVE'),
        countryIso2 ? eq(countries.iso2, countryIso2) : undefined,
        contractType ? eq(jobPosts.contractType, contractType) : undefined,
        workMode ? eq(jobPosts.workMode, workMode) : undefined,
        city ? ilike(jobPosts.city, `%${city}%`) : undefined,
        or(isNull(jobPosts.applicationDeadline), gte(jobPosts.applicationDeadline, now)),
        q ? or(ilike(jobPosts.title, `%${q}%`), ilike(jobPosts.description, `%${q}%`), ilike(jobPosts.city, `%${q}%`)) : undefined
      ))
      .orderBy(desc(jobPosts.publishedAt))
      .limit(100);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({ jobs: rows, total: rows.length });
  } catch (err) {
    console.error('Employment jobs search error:', err);
    res.status(500).json({ error: 'Unable to load employment offers' });
  }
});

app.get('/api/employment/jobs/:id', rateLimit(90, 60_000), async (req, res) => {
  try {
    const jobId = String(req.params.id);
    if (!isValidUuid(jobId)) return res.status(400).json({ error: 'Invalid job ID' });
    const [job] = await db.select({
      id: jobPosts.id, referenceCode: jobPosts.referenceCode, title: jobPosts.title,
      description: jobPosts.description, department: jobPosts.department,
      contractType: jobPosts.contractType, workMode: jobPosts.workMode, city: jobPosts.city,
      salaryMin: jobPosts.salaryMin, salaryMax: jobPosts.salaryMax,
      salaryCurrency: jobPosts.salaryCurrency, salaryPeriod: jobPosts.salaryPeriod,
      experienceLevel: jobPosts.experienceLevel, requiredSkills: jobPosts.requiredSkills,
      applicationDeadline: jobPosts.applicationDeadline, publishedAt: jobPosts.publishedAt,
      organizationName: organizations.name, countryIso2: countries.iso2, countryName: countries.nameFr,
    }).from(jobPosts)
      .innerJoin(organizations, eq(jobPosts.organizationId, organizations.id))
      .innerJoin(countries, eq(jobPosts.countryId, countries.id))
      .innerJoin(countryModules, and(
        eq(countryModules.countryId, countries.id),
        eq(countryModules.moduleKey, 'employment'),
        eq(countryModules.enabled, true)
      ))
      .where(and(
        eq(jobPosts.id, jobId), eq(jobPosts.status, 'PUBLISHED'), eq(countries.status, 'ACTIVE')
      )).limit(1);
    if (!job) return res.status(404).json({ error: 'Published job offer not found' });
    if (job.applicationDeadline && job.applicationDeadline.getTime() < Date.now()) {
      return res.json({ job: { ...job, acceptingApplications: false } });
    }
    res.json({ job: { ...job, acceptingApplications: true } });
  } catch (err) {
    console.error('Employment job detail error:', err);
    res.status(500).json({ error: 'Unable to load job details' });
  }
});

app.post('/api/employment/jobs', requireAuth, rateLimit(20, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const body = req.body || {};
    const organizationId = String(body.organizationId || '');
    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    const city = String(body.city || '').trim();
    const contractType = String(body.contractType || '').toUpperCase();
    const allowedContracts = ['PERMANENT', 'FIXED_TERM', 'TEMPORARY', 'PART_TIME', 'INTERNSHIP', 'APPRENTICESHIP', 'SEASONAL', 'GRADUATE', 'PUBLIC_SERVICE'];
    const workMode = String(body.workMode || 'ONSITE').toUpperCase();
    if (!isValidUuid(organizationId) || title.length < 4 || title.length > 160 ||
        description.length < 30 || description.length > 12000 || !city || city.length > 120 ||
        !allowedContracts.includes(contractType) || !['ONSITE', 'HYBRID', 'REMOTE'].includes(workMode)) {
      return res.status(400).json({ error: 'Invalid job details. Check title, description, location, contract and work mode.' });
    }
    if (!(await canManageEmploymentOrg(organizationId, ctx.profileId, ctx.roles))) {
      return res.status(403).json({ error: 'You cannot publish offers for this organization' });
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const [country] = await db.select().from(countries).where(eq(countries.id, org.countryId)).limit(1);
    if (!country || country.status !== 'ACTIVE' || !(await isEmploymentEnabled(country.id))) {
      return res.status(409).json({ error: 'Employment is not activated for this country' });
    }
    const salaryMin = body.salaryMin === '' || body.salaryMin == null ? null : Number(body.salaryMin);
    const salaryMax = body.salaryMax === '' || body.salaryMax == null ? null : Number(body.salaryMax);
    if ((salaryMin != null && (!Number.isFinite(salaryMin) || salaryMin < 0)) ||
        (salaryMax != null && (!Number.isFinite(salaryMax) || salaryMax < 0)) ||
        (salaryMin != null && salaryMax != null && salaryMax < salaryMin)) {
      return res.status(400).json({ error: 'Invalid salary range' });
    }
    const [job] = await db.insert(jobPosts).values({
      organizationId, countryId: country.id, createdByProfileId: ctx.profileId,
      referenceCode: `JOB-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      title, description, department: body.department ? String(body.department).slice(0, 120) : null,
      contractType, workMode, city, salaryMin: salaryMin == null ? null : salaryMin.toFixed(2),
      salaryMax: salaryMax == null ? null : salaryMax.toFixed(2),
      salaryCurrency: country.defaultCurrency, salaryPeriod: ['HOUR','DAY','MONTH','YEAR'].includes(String(body.salaryPeriod).toUpperCase()) ? String(body.salaryPeriod).toUpperCase() : 'MONTH',
      experienceLevel: body.experienceLevel ? String(body.experienceLevel).slice(0, 40) : null,
      requiredSkills: Array.isArray(body.requiredSkills) ? body.requiredSkills.map((v: unknown) => String(v).trim().slice(0, 60)).filter(Boolean).slice(0, 30) : [],
      applicationDeadline: body.applicationDeadline ? new Date(body.applicationDeadline) : null,
      status: 'DRAFT',
    }).returning();
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: country.iso2, action: 'EMPLOYMENT_JOB_CREATED',
      entityType: 'job_post', entityId: job.id, details: { organizationId, status: 'DRAFT' }
    });
    res.status(201).json({ job });
  } catch (err) {
    console.error('Create employment job error:', err);
    res.status(500).json({ error: 'Unable to create job offer' });
  }
});

app.post('/api/employment/jobs/:id/publish', requireAuth, rateLimit(20, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const jobId = String(req.params.id);
    if (!isValidUuid(jobId)) return res.status(400).json({ error: 'Invalid job ID' });
    const [job] = await db.select().from(jobPosts).where(eq(jobPosts.id, jobId)).limit(1);
    if (!job) return res.status(404).json({ error: 'Job offer not found' });
    if (!(await canManageEmploymentOrg(job.organizationId, ctx.profileId, ctx.roles))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [employerVerification] = await db.select({ status: employerVerifications.status })
      .from(employerVerifications).where(eq(employerVerifications.organizationId, job.organizationId)).limit(1);
    if (employerVerification?.status !== 'VERIFIED') {
      return res.status(403).json({ error: 'Employer verification is required before publishing job offers' });
    }
    if (job.status !== 'DRAFT' && job.status !== 'PAUSED') {
      return res.status(409).json({ error: 'Only draft or paused offers can be published' });
    }
    const [country] = await db.select().from(countries).where(eq(countries.id, job.countryId)).limit(1);
    if (!country || country.status !== 'ACTIVE' || !(await isEmploymentEnabled(job.countryId))) {
      return res.status(409).json({ error: 'Employment is not activated for this country' });
    }
    if (job.applicationDeadline && job.applicationDeadline.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Application deadline must be in the future' });
    }
    const [published] = await db.update(jobPosts).set({
      status: 'PUBLISHED', publishedAt: new Date(), updatedAt: new Date()
    }).where(eq(jobPosts.id, job.id)).returning();
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: country.iso2, action: 'EMPLOYMENT_JOB_PUBLISHED',
      entityType: 'job_post', entityId: job.id, details: { status: 'PUBLISHED' }
    });
    res.json({ job: published });
  } catch (err) {
    console.error('Publish employment job error:', err);
    res.status(500).json({ error: 'Unable to publish job offer' });
  }
});

app.post('/api/employment/jobs/:id/applications', requireAuth, rateLimit(10, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const jobId = String(req.params.id);
    if (!isValidUuid(jobId)) return res.status(400).json({ error: 'Invalid job ID' });
    const [job] = await db.select().from(jobPosts).where(eq(jobPosts.id, jobId)).limit(1);
    if (!job || job.status !== 'PUBLISHED') return res.status(404).json({ error: 'Published job offer not found' });
    if (!(await isEmploymentEnabled(job.countryId))) return res.status(409).json({ error: 'Employment is not currently enabled for this country' });
    const [jobCountry] = await db.select().from(countries).where(eq(countries.id, job.countryId)).limit(1);
    if (!jobCountry || jobCountry.status !== 'ACTIVE') return res.status(409).json({ error: 'Employment is not currently open in this country' });
    if (job.applicationDeadline && job.applicationDeadline.getTime() < Date.now()) {
      return res.status(409).json({ error: 'The application deadline has passed' });
    }
    const coverLetter = req.body?.coverLetter == null ? null : String(req.body.coverLetter).trim().slice(0, 5000);
    const result = await db.transaction(async (tx) => {
      const [candidate] = await tx.insert(candidateProfiles).values({
        profileId: ctx.profileId, countryIso2: ctx.countryIso2, visibility: 'PRIVATE'
      }).onConflictDoNothing().returning();
      let candidateId = candidate?.id;
      if (!candidateId) {
        const [existing] = await tx.select().from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
        candidateId = existing?.id;
      }
      if (!candidateId) throw new Error('Candidate profile could not be initialized');
      const [application] = await tx.insert(jobApplications).values({
        jobPostId: job.id, candidateProfileId: candidateId, coverLetter, status: 'SUBMITTED'
      }).returning();
      await tx.insert(jobApplicationEvents).values({
        applicationId: application.id, actorProfileId: ctx.profileId,
        fromStatus: null, toStatus: 'SUBMITTED', note: 'Application submitted'
      });
      return application;
    });
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: jobCountry.iso2, action: 'EMPLOYMENT_APPLICATION_SUBMITTED',
      entityType: 'job_application', entityId: result.id, details: { jobPostId: job.id }
    });
    await notifyEmploymentOrganization(job.organizationId, {
      type: 'EMPLOYMENT_APPLICATION_SUBMITTED', eventKey: `employment:application-submitted:${result.id}`,
      titleFr: 'Nouvelle candidature', titleEn: 'New job application', titleAr: 'طلب توظيف جديد', titlePt: 'Nova candidatura',
      bodyFr: `Une nouvelle candidature a été reçue pour « ${job.title} ».`,
      bodyEn: `A new application was received for “${job.title}”.`,
      bodyAr: `تم استلام طلب جديد للوظيفة « ${job.title} ».`,
      bodyPt: `Foi recebida uma nova candidatura para « ${job.title} ».`,
    });
    res.status(201).json({ application: result });
  } catch (err: any) {
    if (isPgUniqueViolation(err)) return res.status(409).json({ error: 'You have already applied for this job' });
    console.error('Submit employment application error:', err);
    res.status(500).json({ error: 'Unable to submit application' });
  }
});



// Candidate documents are uploaded server-side into a private quarantine prefix.
const EMPLOYMENT_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
const EMPLOYMENT_DOCUMENT_ALLOWED_TYPES = new Set(['CV', 'CERTIFICATE', 'DIPLOMA', 'OTHER']);

app.post('/api/employment/candidates/me/documents', requireAuth, rateLimit(8, 60_000), express.raw({ type: 'application/pdf', limit: EMPLOYMENT_DOCUMENT_MAX_BYTES }), async (req: AuthRequest, res) => {
  let storagePath: string | null = null;
  try {
    const ctx = req.authCtx!;
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || buffer.length < 8 || buffer.length > EMPLOYMENT_DOCUMENT_MAX_BYTES) {
      return res.status(400).json({ error: 'A PDF file between 8 bytes and 8 MB is required' });
    }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/pdf' ||
        buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return res.status(415).json({ error: 'Only genuine PDF files are accepted' });
    }
    const documentType = String(req.query.documentType || 'CV').toUpperCase();
    if (!EMPLOYMENT_DOCUMENT_ALLOWED_TYPES.has(documentType)) return res.status(400).json({ error: 'Invalid document type' });
    const rawName = String(req.query.fileName || 'document.pdf').split(/[\\/]/).pop() || 'document.pdf';
    const originalFileName = rawName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) || 'document.pdf';
    if (!originalFileName.toLowerCase().endsWith('.pdf')) return res.status(400).json({ error: 'The file name must end with .pdf' });

    let [candidate] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) {
      await db.insert(candidateProfiles).values({
        profileId: ctx.profileId, countryIso2: ctx.countryIso2, visibility: 'PRIVATE',
      }).onConflictDoNothing();
      [candidate] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    }
    if (!candidate) return res.status(500).json({ error: 'Candidate profile could not be initialized' });

    const id = crypto.randomUUID();
    storagePath = `employment/candidates/${ctx.profileId}/quarantine/${id}.pdf`;
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const bucket = getPrivateEmploymentBucket();
    const file = bucket.file(storagePath);
    await file.save(buffer, {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'private, no-store, max-age=0',
        metadata: { candidateProfileId: candidate.id, documentId: id, scanStatus: 'QUARANTINED', sha256 },
      },
    });

    const [document] = await db.insert(candidateDocuments).values({
      id, candidateProfileId: candidate.id, documentType, originalFileName, storagePath,
      mimeType: 'application/pdf', sizeBytes: buffer.length, sha256, scanStatus: 'QUARANTINED',
    }).returning();
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: ctx.countryIso2, action: 'EMPLOYMENT_CANDIDATE_DOCUMENT_UPLOADED',
      entityType: 'candidate_document', entityId: document.id,
      details: { documentType, sizeBytes: buffer.length, sha256, scanStatus: 'QUARANTINED' },
    });
    return res.status(201).json({ document: {
      id: document.id, documentType: document.documentType, originalFileName: document.originalFileName,
      sizeBytes: document.sizeBytes, scanStatus: document.scanStatus, uploadedAt: document.uploadedAt,
    }, message: 'Document stocké en quarantaine. Il ne sera pas transmis aux recruteurs avant analyse antivirus et consentement explicite.' });
  } catch (err) {
    if (storagePath) {
      try { await getPrivateEmploymentBucket().file(storagePath).delete({ ignoreNotFound: true }); } catch { /* best-effort cleanup */ }
    }
    console.error('Candidate document upload error:', err);
    return res.status(503).json({ error: 'Secure document storage is unavailable; the document was not accepted' });
  }
});

app.get('/api/employment/candidates/me/documents', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const [candidate] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) return res.json({ documents: [] });
    const documents = await db.select({
      id: candidateDocuments.id, documentType: candidateDocuments.documentType,
      originalFileName: candidateDocuments.originalFileName, sizeBytes: candidateDocuments.sizeBytes,
      scanStatus: candidateDocuments.scanStatus, uploadedAt: candidateDocuments.uploadedAt,
    }).from(candidateDocuments)
      .where(eq(candidateDocuments.candidateProfileId, candidate.id))
      .orderBy(desc(candidateDocuments.uploadedAt)).limit(50);
    return res.json({ documents });
  } catch (err) {
    console.error('Candidate documents list error:', err);
    return res.status(500).json({ error: 'Unable to load candidate documents' });
  }
});

app.delete('/api/employment/candidates/me/documents/:id', requireAuth, rateLimit(20, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const id = String(req.params.id);
    if (!isValidUuid(id)) return res.status(400).json({ error: 'Invalid document ID' });
    const [candidate] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) return res.status(404).json({ error: 'Document not found' });
    const [document] = await db.select().from(candidateDocuments).where(and(
      eq(candidateDocuments.id, id), eq(candidateDocuments.candidateProfileId, candidate.id)
    )).limit(1);
    if (!document || document.scanStatus === 'DELETED') return res.status(404).json({ error: 'Document not found' });
    await getPrivateEmploymentBucket().file(document.storagePath).delete({ ignoreNotFound: true });
    await db.update(candidateDocuments).set({ scanStatus: 'DELETED', updatedAt: new Date() }).where(eq(candidateDocuments.id, id));
    await db.delete(candidateDocumentShares).where(eq(candidateDocumentShares.documentId, id));
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: ctx.countryIso2, action: 'EMPLOYMENT_CANDIDATE_DOCUMENT_DELETED',
      entityType: 'candidate_document', entityId: id, details: { previousScanStatus: document.scanStatus },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('Candidate document delete error:', err);
    return res.status(503).json({ error: 'Unable to securely delete this document right now' });
  }
});

app.post('/api/employment/candidates/me/documents/:id/share', requireAuth, rateLimit(30, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const documentId = String(req.params.id);
    const applicationId = String(req.body?.applicationId || '');
    if (!isValidUuid(documentId) || !isValidUuid(applicationId)) return res.status(400).json({ error: 'Invalid document or application ID' });
    const [candidate] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) return res.status(404).json({ error: 'Candidate profile not found' });
    const [document] = await db.select().from(candidateDocuments).where(and(
      eq(candidateDocuments.id, documentId), eq(candidateDocuments.candidateProfileId, candidate.id),
      sql`${candidateDocuments.scanStatus} <> 'DELETED'`
    )).limit(1);
    if (!document) return res.status(404).json({ error: 'Document not found' });
    const [application] = await db.select().from(jobApplications).where(and(
      eq(jobApplications.id, applicationId), eq(jobApplications.candidateProfileId, candidate.id)
    )).limit(1);
    if (!application) return res.status(404).json({ error: 'Your application was not found' });
    await db.insert(candidateDocumentShares).values({ documentId, applicationId, consentedAt: new Date(), revokedAt: null })
      .onConflictDoUpdate({
        target: [candidateDocumentShares.documentId, candidateDocumentShares.applicationId],
        set: { consentedAt: new Date(), revokedAt: null },
      });
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: ctx.countryIso2, action: 'EMPLOYMENT_CANDIDATE_DOCUMENT_SHARE_CONSENTED',
      entityType: 'candidate_document', entityId: documentId,
      details: { applicationId, scanStatus: document.scanStatus },
    });
    return res.json({ success: true, scanStatus: document.scanStatus, message: document.scanStatus === 'CLEAN'
      ? 'Consentement enregistré : le recruteur autorisé pourra accéder au document.'
      : 'Consentement enregistré. Le document reste inaccessible au recruteur jusqu’à validation antivirus.' });
  } catch (err) {
    console.error('Candidate document share consent error:', err);
    return res.status(500).json({ error: 'Unable to save document sharing consent' });
  }
});

app.delete('/api/employment/candidates/me/documents/:id/share/:applicationId', requireAuth, rateLimit(30, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const documentId = String(req.params.id), applicationId = String(req.params.applicationId);
    if (!isValidUuid(documentId) || !isValidUuid(applicationId)) return res.status(400).json({ error: 'Invalid document or application ID' });
    const [candidate] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) return res.status(404).json({ error: 'Candidate profile not found' });
    const [document] = await db.select({ id: candidateDocuments.id }).from(candidateDocuments).where(and(
      eq(candidateDocuments.id, documentId), eq(candidateDocuments.candidateProfileId, candidate.id)
    )).limit(1);
    if (!document) return res.status(404).json({ error: 'Document not found' });
    await db.update(candidateDocumentShares).set({ revokedAt: new Date() }).where(and(
      eq(candidateDocumentShares.documentId, documentId), eq(candidateDocumentShares.applicationId, applicationId)
    ));
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: ctx.countryIso2, action: 'EMPLOYMENT_CANDIDATE_DOCUMENT_SHARE_REVOKED',
      entityType: 'candidate_document', entityId: documentId, details: { applicationId },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('Candidate document share revoke error:', err);
    return res.status(500).json({ error: 'Unable to revoke document sharing' });
  }
});

app.get('/api/employment/applications/:id/documents', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const applicationId = String(req.params.id);
    if (!isValidUuid(applicationId)) return res.status(400).json({ error: 'Invalid application ID' });
    const [row] = await db.select({
      applicationId: jobApplications.id, organizationId: jobPosts.organizationId,
    }).from(jobApplications).innerJoin(jobPosts, eq(jobApplications.jobPostId, jobPosts.id))
      .where(eq(jobApplications.id, applicationId)).limit(1);
    if (!row || !(await canManageEmploymentOrg(row.organizationId, ctx.profileId, ctx.roles))) {
      return res.status(404).json({ error: 'Application not found' });
    }
    const shared = await db.select({
      id: candidateDocuments.id, documentType: candidateDocuments.documentType,
      originalFileName: candidateDocuments.originalFileName, sizeBytes: candidateDocuments.sizeBytes,
      scanStatus: candidateDocuments.scanStatus, consentedAt: candidateDocumentShares.consentedAt,
      storagePath: candidateDocuments.storagePath,
    }).from(candidateDocumentShares)
      .innerJoin(candidateDocuments, eq(candidateDocumentShares.documentId, candidateDocuments.id))
      .where(and(
        eq(candidateDocumentShares.applicationId, applicationId),
        sql`${candidateDocumentShares.revokedAt} IS NULL`,
        sql`${candidateDocuments.scanStatus} <> 'DELETED'`
      )).limit(30);
    const documents = await Promise.all(shared.map(async (doc) => {
      let downloadUrl: string | null = null;
      if (doc.scanStatus === 'CLEAN') {
        const [signed] = await getPrivateEmploymentBucket().file(doc.storagePath).getSignedUrl({
          action: 'read', expires: Date.now() + 5 * 60 * 1000,
          responseDisposition: `attachment; filename="${doc.originalFileName.replace(/["\\\\]/g, '')}"`,
        });
        downloadUrl = signed;
      }
      return { id: doc.id, documentType: doc.documentType, originalFileName: doc.originalFileName,
        sizeBytes: doc.sizeBytes, scanStatus: doc.scanStatus, consentedAt: doc.consentedAt, downloadUrl };
    }));
    return res.json({ documents });
  } catch (err) {
    console.error('Employer shared documents read error:', err);
    return res.status(500).json({ error: 'Unable to load shared documents' });
  }
});

app.get('/api/employment/candidates/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const [candidate] = await db.select().from(candidateProfiles)
      .where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    const [profile] = await db.select({
      fullName: profiles.fullName, email: profiles.email,
      phone: profiles.phone, avatarUrl: profiles.avatarUrl,
      countryIso2: profiles.countryIso2, cityName: profiles.cityName,
    }).from(profiles).where(eq(profiles.id, ctx.profileId)).limit(1);
    res.json({ candidate: candidate || null, profile: profile || null });
  } catch (err) {
    console.error('Candidate profile read error:', err);
    res.status(500).json({ error: 'Unable to load candidate profile' });
  }
});

app.patch('/api/employment/candidates/me', requireAuth, rateLimit(30, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const body = req.body || {};
    const headline = String(body.headline || '').trim();
    const summary = String(body.summary || '').trim();
    const city = String(body.city || '').trim();
    const skills: string[] = Array.isArray(body.skills)
      ? Array.from(new Set<string>(
          (body.skills as unknown[])
            .map((value: unknown): string => String(value).trim().slice(0, 60))
            .filter((value: string) => value.length > 0)
        )).slice(0, 40)
      : [];
    const experienceYears = Number(body.experienceYears ?? 0);
    const visibility = String(body.visibility || 'PRIVATE').toUpperCase();
    if (headline.length > 160 || summary.length > 4000 || city.length > 120 ||
        !Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 60 ||
        !['PRIVATE', 'EMPLOYERS_WITH_APPLICATION', 'PUBLIC'].includes(visibility)) {
      return res.status(400).json({ error: 'Invalid candidate profile fields' });
    }
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, ctx.profileId)).limit(1);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    const [saved] = await db.insert(candidateProfiles).values({
      profileId: ctx.profileId, countryIso2: profile.countryIso2,
      headline: headline || null, summary: summary || null, city: city || null,
      skills, experienceYears, visibility, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: candidateProfiles.profileId,
      set: { headline: headline || null, summary: summary || null, city: city || null,
        skills, experienceYears, visibility, updatedAt: new Date() },
    }).returning();
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: profile.countryIso2, action: 'EMPLOYMENT_CANDIDATE_PROFILE_UPDATED',
      entityType: 'candidate_profile', entityId: saved.id,
      details: { visibility, skillsCount: skills.length, experienceYears },
    });
    res.json({ candidate: saved });
  } catch (err) {
    console.error('Candidate profile update error:', err);
    res.status(500).json({ error: 'Unable to save candidate profile' });
  }
});

app.get('/api/employment/employer/jobs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const organizationId = String(req.query.organizationId || '');
    if (!isValidUuid(organizationId)) return res.status(400).json({ error: 'Valid organizationId is required' });
    if (!(await canManageEmploymentOrg(organizationId, ctx.profileId, ctx.roles))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const jobs = await db.select({
      id: jobPosts.id, referenceCode: jobPosts.referenceCode, title: jobPosts.title,
      city: jobPosts.city, status: jobPosts.status, publishedAt: jobPosts.publishedAt,
      createdAt: jobPosts.createdAt,
    }).from(jobPosts).where(eq(jobPosts.organizationId, organizationId))
      .orderBy(desc(jobPosts.createdAt));
    const ids = jobs.map((j) => j.id);
    const counts = ids.length ? await db.select({
      jobPostId: jobApplications.jobPostId,
      status: jobApplications.status,
      count: sql<number>`count(*)::int`,
    }).from(jobApplications).where(inArray(jobApplications.jobPostId, ids))
      .groupBy(jobApplications.jobPostId, jobApplications.status) : [];
    const byJob = new Map<string, Record<string, number>>();
    for (const row of counts) {
      const item = byJob.get(row.jobPostId) || {};
      item[row.status] = Number(row.count);
      byJob.set(row.jobPostId, item);
    }
    res.json({ jobs: jobs.map((job) => ({ ...job, applicationCounts: byJob.get(job.id) || {} })) });
  } catch (err) {
    console.error('Employer job list error:', err);
    res.status(500).json({ error: 'Unable to load employer jobs' });
  }
});

app.get('/api/employment/me/applications', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const [candidate] = await db.select().from(candidateProfiles)
      .where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) return res.json({ applications: [] });
    const rows = await db.select({
      id: jobApplications.id, status: jobApplications.status,
      submittedAt: jobApplications.submittedAt, updatedAt: jobApplications.updatedAt,
      coverLetter: jobApplications.coverLetter,
      jobId: jobPosts.id, jobTitle: jobPosts.title, jobCity: jobPosts.city,
      contractType: jobPosts.contractType, workMode: jobPosts.workMode,
      organizationName: organizations.name, countryIso2: countries.iso2,
    }).from(jobApplications)
      .innerJoin(jobPosts, eq(jobApplications.jobPostId, jobPosts.id))
      .innerJoin(organizations, eq(jobPosts.organizationId, organizations.id))
      .innerJoin(countries, eq(jobPosts.countryId, countries.id))
      .where(eq(jobApplications.candidateProfileId, candidate.id))
      .orderBy(desc(jobApplications.submittedAt));
    res.json({ applications: rows });
  } catch (err) {
    console.error('Candidate applications error:', err);
    res.status(500).json({ error: 'Unable to load your applications' });
  }
});

app.get('/api/employment/applications/:id/events', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const applicationId = String(req.params.id);
    if (!isValidUuid(applicationId)) return res.status(400).json({ error: 'Invalid application ID' });
    const [application] = await db.select({
      id: jobApplications.id,
      candidateProfileId: jobApplications.candidateProfileId,
      organizationId: jobPosts.organizationId,
    }).from(jobApplications)
      .innerJoin(jobPosts, eq(jobApplications.jobPostId, jobPosts.id))
      .where(eq(jobApplications.id, applicationId)).limit(1);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const [candidate] = await db.select({ id: candidateProfiles.id })
      .from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    const isCandidate = candidate?.id === application.candidateProfileId;
    const isEmployer = await canManageEmploymentOrg(application.organizationId, ctx.profileId, ctx.roles);
    if (!isCandidate && !isEmployer) return res.status(404).json({ error: 'Application not found' });

    const events = await db.select({
      id: jobApplicationEvents.id,
      fromStatus: jobApplicationEvents.fromStatus,
      toStatus: jobApplicationEvents.toStatus,
      note: isEmployer ? jobApplicationEvents.note : sql<string>`NULL`,
      createdAt: jobApplicationEvents.createdAt,
    }).from(jobApplicationEvents)
      .where(eq(jobApplicationEvents.applicationId, applicationId))
      .orderBy(desc(jobApplicationEvents.createdAt))
      .limit(100);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ events });
  } catch (err) {
    console.error('Employment application history error:', err);
    res.status(500).json({ error: 'Unable to load application history' });
  }
});

app.get('/api/employment/jobs/:id/applications', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const jobId = String(req.params.id);
    if (!isValidUuid(jobId)) return res.status(400).json({ error: 'Invalid job ID' });
    const [job] = await db.select().from(jobPosts).where(eq(jobPosts.id, jobId)).limit(1);
    if (!job) return res.status(404).json({ error: 'Job offer not found' });
    if (!(await canManageEmploymentOrg(job.organizationId, ctx.profileId, ctx.roles))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const rows = await db.select({
      id: jobApplications.id, status: jobApplications.status,
      submittedAt: jobApplications.submittedAt, updatedAt: jobApplications.updatedAt,
      coverLetter: jobApplications.coverLetter,
      candidateProfileId: candidateProfiles.id,
      headline: candidateProfiles.headline, summary: candidateProfiles.summary,
      city: candidateProfiles.city, countryIso2: candidateProfiles.countryIso2,
      skills: candidateProfiles.skills, experienceYears: candidateProfiles.experienceYears,
      candidateName: profiles.fullName,
    }).from(jobApplications)
      .innerJoin(candidateProfiles, eq(jobApplications.candidateProfileId, candidateProfiles.id))
      .innerJoin(profiles, eq(candidateProfiles.profileId, profiles.id))
      .where(eq(jobApplications.jobPostId, job.id))
      .orderBy(desc(jobApplications.submittedAt));
    res.json({ applications: rows });
  } catch (err) {
    console.error('Employer applications error:', err);
    res.status(500).json({ error: 'Unable to load applications' });
  }
});

app.post('/api/employment/applications/:id/withdraw', requireAuth, rateLimit(20, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const applicationId = String(req.params.id);
    if (!isValidUuid(applicationId)) return res.status(400).json({ error: 'Invalid application ID' });
    const [candidate] = await db.select({ id: candidateProfiles.id })
      .from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) return res.status(404).json({ error: 'Application not found' });
    const [application] = await db.select().from(jobApplications).where(and(
      eq(jobApplications.id, applicationId),
      eq(jobApplications.candidateProfileId, candidate.id)
    )).limit(1);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (!['SUBMITTED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEW'].includes(application.status)) {
      return res.status(409).json({ error: 'This application can no longer be withdrawn' });
    }
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(jobApplications)
        .set({ status: 'WITHDRAWN', updatedAt: new Date() })
        .where(and(
          eq(jobApplications.id, application.id),
          eq(jobApplications.candidateProfileId, candidate.id),
          eq(jobApplications.status, application.status)
        )).returning();
      if (!row) throw new Error('Application status changed concurrently; reload and retry');
      await tx.insert(jobApplicationEvents).values({
        applicationId: application.id, actorProfileId: ctx.profileId,
        fromStatus: application.status, toStatus: 'WITHDRAWN',
        note: 'Candidate withdrew the application',
      });
      return row;
    });
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      action: 'EMPLOYMENT_APPLICATION_WITHDRAWN', entityType: 'job_application',
      entityId: application.id, details: { jobPostId: application.jobPostId },
    });
    const [withdrawnJob] = await db.select({ organizationId: jobPosts.organizationId, title: jobPosts.title })
      .from(jobPosts).where(eq(jobPosts.id, application.jobPostId)).limit(1);
    if (withdrawnJob) await notifyEmploymentOrganization(withdrawnJob.organizationId, {
      type: 'EMPLOYMENT_APPLICATION_WITHDRAWN', eventKey: `employment:application-withdrawn:${application.id}`,
      titleFr: 'Candidature retirée', titleEn: 'Application withdrawn', titleAr: 'تم سحب طلب التوظيف', titlePt: 'Candidatura retirada',
      bodyFr: `Un candidat a retiré sa candidature pour « ${withdrawnJob.title} ».`,
      bodyEn: `A candidate withdrew their application for “${withdrawnJob.title}”.`,
      bodyAr: `قام أحد المرشحين بسحب طلبه للوظيفة « ${withdrawnJob.title} ».`,
      bodyPt: `Um candidato retirou a candidatura para « ${withdrawnJob.title} ».`,
    });
    res.json({ application: updated });
  } catch (err: any) {
    if (String(err?.message || '').includes('concurrently')) return res.status(409).json({ error: err.message });
    console.error('Withdraw employment application error:', err);
    res.status(500).json({ error: 'Unable to withdraw application' });
  }
});

app.post('/api/employment/applications/:id/interviews', requireAuth, rateLimit(20, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const applicationId = String(req.params.id);
    if (!isValidUuid(applicationId)) return res.status(400).json({ error: 'Invalid application ID' });
    const [application] = await db.select().from(jobApplications).where(eq(jobApplications.id, applicationId)).limit(1);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const [job] = await db.select().from(jobPosts).where(eq(jobPosts.id, application.jobPostId)).limit(1);
    if (!job || !(await canManageEmploymentOrg(job.organizationId, ctx.profileId, ctx.roles))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!['SUBMITTED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEW'].includes(application.status)) {
      return res.status(409).json({ error: 'An interview cannot be scheduled at this application stage' });
    }
    const startsAt = new Date(req.body?.startsAt);
    const endsAt = new Date(req.body?.endsAt);
    const timezone = String(req.body?.timezone || '').trim();
    const mode = String(req.body?.mode || '').toUpperCase();
    const locationOrUrl = req.body?.locationOrUrl == null ? null : String(req.body.locationOrUrl).trim().slice(0, 500);
    const internalNotes = req.body?.internalNotes == null ? null : String(req.body.internalNotes).trim().slice(0, 2000);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) ||
        endsAt.getTime() <= startsAt.getTime() || startsAt.getTime() < Date.now() - 60_000 ||
        !timezone || timezone.length > 80 || !['VIDEO', 'PHONE', 'ONSITE'].includes(mode) ||
        (mode !== 'PHONE' && !locationOrUrl)) {
      return res.status(400).json({ error: 'Invalid interview schedule' });
    }
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
    catch { return res.status(400).json({ error: 'Invalid IANA timezone' }); }
    const interview = await db.transaction(async (tx) => {
      const [created] = await tx.insert(jobInterviews).values({
        applicationId, scheduledByProfileId: ctx.profileId, startsAt, endsAt,
        timezone, mode, locationOrUrl, internalNotes, status: 'SCHEDULED',
      }).returning();
      if (application.status !== 'INTERVIEW') {
        const [updated] = await tx.update(jobApplications)
          .set({ status: 'INTERVIEW', updatedAt: new Date() })
          .where(and(eq(jobApplications.id, application.id), eq(jobApplications.status, application.status)))
          .returning();
        if (!updated) throw new Error('Application status changed concurrently; reload and retry');
        await tx.insert(jobApplicationEvents).values({
          applicationId: application.id, actorProfileId: ctx.profileId,
          fromStatus: application.status, toStatus: 'INTERVIEW', note: 'Interview scheduled',
        });
      }
      return created;
    });
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      action: 'EMPLOYMENT_INTERVIEW_SCHEDULED', entityType: 'job_interview',
      entityId: interview.id, details: { applicationId, mode, startsAt: startsAt.toISOString() },
    });
    await notifyEmploymentCandidate(application.candidateProfileId, {
      type: 'EMPLOYMENT_INTERVIEW_SCHEDULED', eventKey: `employment:interview-scheduled:${interview.id}`,
      titleFr: 'Invitation à un entretien', titleEn: 'Interview invitation', titleAr: 'دعوة لإجراء مقابلة', titlePt: 'Convite para entrevista',
      bodyFr: `Un entretien est planifié pour « ${job.title} » le ${startsAt.toLocaleString('fr-FR', { timeZone: timezone })}.`,
      bodyEn: `An interview for “${job.title}” is scheduled on ${startsAt.toLocaleString('en-GB', { timeZone: timezone })}.`,
      bodyAr: `تم تحديد موعد مقابلة للوظيفة « ${job.title} » في ${startsAt.toLocaleString('en-GB', { timeZone: timezone })}.`,
      bodyPt: `Uma entrevista para « ${job.title} » foi marcada para ${startsAt.toLocaleString('pt-PT', { timeZone: timezone })}.`,
    });
    res.status(201).json({ interview });
  } catch (err: any) {
    if (String(err?.message || '').includes('concurrently')) return res.status(409).json({ error: err.message });
    console.error('Schedule employment interview error:', err);
    res.status(500).json({ error: 'Unable to schedule interview' });
  }
});

app.get('/api/employment/me/interviews', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const [candidate] = await db.select({ id: candidateProfiles.id })
      .from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) return res.json({ interviews: [] });
    const interviews = await db.select({
      id: jobInterviews.id, startsAt: jobInterviews.startsAt, endsAt: jobInterviews.endsAt,
      timezone: jobInterviews.timezone, mode: jobInterviews.mode,
      locationOrUrl: jobInterviews.locationOrUrl, candidateResponse: jobInterviews.candidateResponse,
      status: jobInterviews.status, candidateMessage: jobInterviews.candidateMessage,
      jobTitle: jobPosts.title, organizationName: organizations.name, applicationId: jobApplications.id,
    }).from(jobInterviews)
      .innerJoin(jobApplications, eq(jobInterviews.applicationId, jobApplications.id))
      .innerJoin(jobPosts, eq(jobApplications.jobPostId, jobPosts.id))
      .innerJoin(organizations, eq(jobPosts.organizationId, organizations.id))
      .where(eq(jobApplications.candidateProfileId, candidate.id))
      .orderBy(desc(jobInterviews.startsAt));
    res.json({ interviews });
  } catch (err) {
    console.error('Candidate interviews error:', err);
    res.status(500).json({ error: 'Unable to load interviews' });
  }
});

app.patch('/api/employment/interviews/:id/response', requireAuth, rateLimit(20, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const interviewId = String(req.params.id);
    const response = String(req.body?.response || '').toUpperCase();
    const message = req.body?.message == null ? null : String(req.body.message).trim().slice(0, 1000);
    if (!isValidUuid(interviewId) || !['CONFIRMED', 'DECLINED'].includes(response)) {
      return res.status(400).json({ error: 'Invalid interview response' });
    }
    const [candidate] = await db.select({ id: candidateProfiles.id })
      .from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) return res.status(404).json({ error: 'Interview not found' });
    const [interview] = await db.select({
      interview: jobInterviews, applicationId: jobApplications.id,
      candidateProfileId: jobApplications.candidateProfileId,
    }).from(jobInterviews)
      .innerJoin(jobApplications, eq(jobInterviews.applicationId, jobApplications.id))
      .where(eq(jobInterviews.id, interviewId)).limit(1);
    if (!interview || interview.candidateProfileId !== candidate.id) return res.status(404).json({ error: 'Interview not found' });
    if (interview.interview.status !== 'SCHEDULED' || interview.interview.startsAt.getTime() < Date.now()) {
      return res.status(409).json({ error: 'This interview can no longer be answered' });
    }
    const [updated] = await db.update(jobInterviews).set({
      candidateResponse: response, candidateMessage: message, updatedAt: new Date(),
    }).where(and(
      eq(jobInterviews.id, interviewId), eq(jobInterviews.status, 'SCHEDULED')
    )).returning();
    if (!updated) return res.status(409).json({ error: 'Interview was updated concurrently' });
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      action: 'EMPLOYMENT_INTERVIEW_RESPONSE', entityType: 'job_interview',
      entityId: interviewId, details: { response },
    });
    const [interviewContext] = await db.select({
      organizationId: jobPosts.organizationId, jobTitle: jobPosts.title,
    }).from(jobApplications)
      .innerJoin(jobPosts, eq(jobApplications.jobPostId, jobPosts.id))
      .where(eq(jobApplications.id, interview.applicationId)).limit(1);
    if (interviewContext) await notifyEmploymentOrganization(interviewContext.organizationId, {
      type: 'EMPLOYMENT_INTERVIEW_RESPONSE', eventKey: `employment:interview-response:${interviewId}:${response}`,
      titleFr: 'Réponse à une invitation', titleEn: 'Interview invitation response', titleAr: 'الرد على دعوة المقابلة', titlePt: 'Resposta ao convite de entrevista',
      bodyFr: `Le candidat a ${response === 'CONFIRMED' ? 'confirmé' : 'refusé'} l’entretien pour « ${interviewContext.jobTitle} ».`,
      bodyEn: `The candidate has ${response === 'CONFIRMED' ? 'confirmed' : 'declined'} the interview for “${interviewContext.jobTitle}”.`,
      bodyAr: `قام المرشح ${response === 'CONFIRMED' ? 'بتأكيد' : 'برفض'} المقابلة للوظيفة « ${interviewContext.jobTitle} ».`,
      bodyPt: `O candidato ${response === 'CONFIRMED' ? 'confirmou' : 'recusou'} a entrevista para « ${interviewContext.jobTitle} ».`,
    });
    res.json({ interview: updated });
  } catch (err) {
    console.error('Interview response error:', err);
    res.status(500).json({ error: 'Unable to save interview response' });
  }
});

app.get('/api/employment/jobs/:id/interviews', requireAuth, rateLimit(60, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const jobId = String(req.params.id);
    if (!isValidUuid(jobId)) return res.status(400).json({ error: 'Invalid job ID' });
    const [job] = await db.select().from(jobPosts).where(eq(jobPosts.id, jobId)).limit(1);
    if (!job) return res.status(404).json({ error: 'Job offer not found' });
    if (!(await canManageEmploymentOrg(job.organizationId, ctx.profileId, ctx.roles))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const interviews = await db.select({
      interview: jobInterviews,
      applicationId: jobApplications.id,
      candidateName: profiles.fullName,
    }).from(jobInterviews)
      .innerJoin(jobApplications, eq(jobInterviews.applicationId, jobApplications.id))
      .leftJoin(candidateProfiles, eq(jobApplications.candidateProfileId, candidateProfiles.id))
      .leftJoin(profiles, eq(candidateProfiles.profileId, profiles.id))
      .where(eq(jobApplications.jobPostId, jobId))
      .orderBy(desc(jobInterviews.startsAt));
    const interviewIds = interviews.map(row => row.interview.id);
    const evaluations = interviewIds.length
      ? await db.select().from(jobInterviewEvaluations)
          .where(inArray(jobInterviewEvaluations.interviewId, interviewIds))
          .orderBy(desc(jobInterviewEvaluations.updatedAt))
      : [];
    res.json({
      interviews: interviews.map(row => ({
        ...row.interview,
        applicationId: row.applicationId,
        candidateName: row.candidateName || 'Candidat',
        evaluations: evaluations.filter(evaluation => evaluation.interviewId === row.interview.id),
        myEvaluation: evaluations.find(evaluation =>
          evaluation.interviewId === row.interview.id && evaluation.reviewerProfileId === ctx.profileId
        ) || null,
      })),
    });
  } catch (err) {
    console.error('Employer interviews error:', err);
    res.status(500).json({ error: 'Unable to load employer interviews' });
  }
});

app.post('/api/employment/interviews/:id/evaluation', requireAuth, rateLimit(30, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const interviewId = String(req.params.id);
    const score = Number(req.body?.score);
    const recommendation = String(req.body?.recommendation || '').toUpperCase();
    const strengths = String(req.body?.strengths || '').trim().slice(0, 3000);
    const concerns = String(req.body?.concerns || '').trim().slice(0, 3000);
    if (!isValidUuid(interviewId) || !Number.isInteger(score) || score < 1 || score > 5 ||
        !['STRONG_YES', 'YES', 'HOLD', 'NO'].includes(recommendation)) {
      return res.status(400).json({ error: 'Invalid interview evaluation' });
    }
    const [interview] = await db.select({
      interview: jobInterviews, organizationId: jobPosts.organizationId,
    }).from(jobInterviews)
      .innerJoin(jobApplications, eq(jobInterviews.applicationId, jobApplications.id))
      .innerJoin(jobPosts, eq(jobApplications.jobPostId, jobPosts.id))
      .where(eq(jobInterviews.id, interviewId)).limit(1);
    if (!interview) return res.status(404).json({ error: 'Interview not found' });
    if (!(await canManageEmploymentOrg(interview.organizationId, ctx.profileId, ctx.roles))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [evaluation] = await db.insert(jobInterviewEvaluations).values({
      interviewId, reviewerProfileId: ctx.profileId, score, recommendation, strengths, concerns,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [jobInterviewEvaluations.interviewId, jobInterviewEvaluations.reviewerProfileId],
      set: { score, recommendation, strengths, concerns, updatedAt: new Date() },
    }).returning();
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      action: 'EMPLOYMENT_INTERVIEW_EVALUATED', entityType: 'job_interview',
      entityId: interviewId, details: { score, recommendation },
    });
    res.json({ evaluation });
  } catch (err) {
    console.error('Interview evaluation error:', err);
    res.status(500).json({ error: 'Unable to save interview evaluation' });
  }
});

app.patch('/api/employment/applications/:id/status', requireAuth, rateLimit(40, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const applicationId = String(req.params.id);
    const nextStatus = String(req.body?.status || '').toUpperCase();
    const allowed = ['REVIEWING', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'REJECTED'];
    if (!isValidUuid(applicationId) || !allowed.includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid application ID or status' });
    }
    const [application] = await db.select().from(jobApplications)
      .where(eq(jobApplications.id, applicationId)).limit(1);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const [job] = await db.select().from(jobPosts)
      .where(eq(jobPosts.id, application.jobPostId)).limit(1);
    if (!job || !(await canManageEmploymentOrg(job.organizationId, ctx.profileId, ctx.roles))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const transitions: Record<string, string[]> = {
      SUBMITTED: ['REVIEWING', 'REJECTED'],
      REVIEWING: ['SHORTLISTED', 'INTERVIEW', 'REJECTED'],
      SHORTLISTED: ['INTERVIEW', 'OFFER', 'REJECTED'],
      INTERVIEW: ['OFFER', 'REJECTED'],
      OFFER: ['REJECTED'],
      HIRED: [], REJECTED: [], WITHDRAWN: [],
    };
    if (!(transitions[application.status] || []).includes(nextStatus)) {
      return res.status(409).json({ error: `Transition ${application.status} → ${nextStatus} is not allowed` });
    }
    const note = req.body?.note == null ? null : String(req.body.note).trim().slice(0, 1000);
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(jobApplications)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(and(eq(jobApplications.id, application.id), eq(jobApplications.status, application.status)))
        .returning();
      if (!row) throw new Error('Application status changed concurrently; reload and retry');
      await tx.insert(jobApplicationEvents).values({
        applicationId: application.id, actorProfileId: ctx.profileId,
        fromStatus: application.status, toStatus: nextStatus, note,
      });
      return row;
    });
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      action: 'EMPLOYMENT_APPLICATION_STATUS_CHANGED', entityType: 'job_application',
      entityId: application.id, details: { jobPostId: job.id, from: application.status, to: nextStatus },
    });
    await notifyEmploymentCandidate(application.candidateProfileId, {
      type: 'EMPLOYMENT_APPLICATION_STATUS_CHANGED', eventKey: `employment:application-status:${application.id}:${nextStatus}`,
      titleFr: 'Mise à jour de candidature', titleEn: 'Application status updated', titleAr: 'تحديث حالة طلب التوظيف', titlePt: 'Estado da candidatura atualizado',
      bodyFr: `Votre candidature pour « ${job.title} » est passée à l’étape « ${nextStatus} ».`,
      bodyEn: `Your application for “${job.title}” moved to “${nextStatus}”.`,
      bodyAr: `تم تحديث طلبك للوظيفة « ${job.title} » إلى « ${nextStatus} ».`,
      bodyPt: `A sua candidatura para « ${job.title} » passou para « ${nextStatus} ».`,
    });
    res.json({ application: updated });
  } catch (err: any) {
    if (String(err?.message || '').includes('concurrently')) return res.status(409).json({ error: err.message });
    console.error('Update application status error:', err);
    res.status(500).json({ error: 'Unable to update application status' });
  }
});

app.post('/api/employment/applications/:id/offers', requireAuth, rateLimit(10, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const applicationId = String(req.params.id);
    if (!isValidUuid(applicationId)) return res.status(400).json({ error: 'Invalid application ID' });
    const [application] = await db.select().from(jobApplications)
      .where(eq(jobApplications.id, applicationId)).limit(1);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const [job] = await db.select().from(jobPosts).where(eq(jobPosts.id, application.jobPostId)).limit(1);
    if (!job || !(await canManageEmploymentOrg(job.organizationId, ctx.profileId, ctx.roles))) {
      return res.status(404).json({ error: 'Application not found or access denied' });
    }
    if (application.status !== 'OFFER') {
      return res.status(409).json({ error: 'Move the application to OFFER before sending an employment offer' });
    }
    const [verification] = await db.select({ status: employerVerifications.status })
      .from(employerVerifications).where(eq(employerVerifications.organizationId, job.organizationId)).limit(1);
    if (verification?.status !== 'VERIFIED') {
      return res.status(403).json({ error: 'Verified employer status is required' });
    }
    const [country] = await db.select().from(countries).where(eq(countries.id, job.countryId)).limit(1);
    if (!country) return res.status(409).json({ error: 'Country configuration is unavailable' });

    const salaryAmount = Number(req.body?.salaryAmount);
    const payFrequency = String(req.body?.payFrequency || 'MONTH').toUpperCase();
    const startDate = String(req.body?.startDate || '');
    const workLocation = String(req.body?.workLocation || '').trim().slice(0, 240);
    const weeklyHours = req.body?.weeklyHours == null || req.body.weeklyHours === '' ? null : Number(req.body.weeklyHours);
    const probationDays = req.body?.probationDays == null || req.body.probationDays === '' ? null : Number(req.body.probationDays);
    const benefits = req.body?.benefits == null ? null : String(req.body.benefits).trim().slice(0, 3000);
    const additionalConditions = req.body?.additionalConditions == null ? null : String(req.body.additionalConditions).trim().slice(0, 5000);
    const localLawNotice = req.body?.localLawNotice == null ? null : String(req.body.localLawNotice).trim().slice(0, 3000);
    const expiresInDays = Number(req.body?.expiresInDays ?? 7);
    const startDateTime = new Date(`${startDate}T00:00:00.000Z`);
    if (!Number.isFinite(salaryAmount) || salaryAmount <= 0 || salaryAmount > 1_000_000_000 ||
        !['HOUR', 'WEEK', 'MONTH', 'YEAR'].includes(payFrequency) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(startDateTime.getTime()) ||
        startDateTime.toISOString().slice(0, 10) !== startDate ||
        startDate < new Date().toISOString().slice(0, 10) ||
        !workLocation || (weeklyHours !== null && (!Number.isFinite(weeklyHours) || weeklyHours <= 0 || weeklyHours > 168)) ||
        (probationDays !== null && (!Number.isInteger(probationDays) || probationDays < 0 || probationDays > 365)) ||
        !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
      return res.status(400).json({ error: 'Invalid offer terms. Check salary, pay frequency, start date, location and expiry.' });
    }
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const offer = await db.transaction(async (tx) => {
      const previous = await tx.select({ version: employmentOffers.version })
        .from(employmentOffers).where(eq(employmentOffers.applicationId, application.id))
        .orderBy(desc(employmentOffers.version)).limit(1);
      const version = (previous[0]?.version || 0) + 1;
      await tx.update(employmentOffers).set({ status: 'SUPERSEDED', updatedAt: new Date() })
        .where(and(eq(employmentOffers.applicationId, application.id), eq(employmentOffers.status, 'SENT')));
      const [created] = await tx.insert(employmentOffers).values({
        applicationId: application.id, jobPostId: job.id, organizationId: job.organizationId,
        candidateProfileId: application.candidateProfileId, countryId: job.countryId, version,
        status: 'SENT', jobTitleSnapshot: job.title, contractType: job.contractType,
        salaryAmount: salaryAmount.toFixed(2), salaryCurrency: country.defaultCurrency,
        payFrequency, startDate, workLocation, weeklyHours: weeklyHours === null ? null : weeklyHours.toFixed(2),
        probationDays, benefits, additionalConditions, localLawNotice, expiresAt,
        createdByProfileId: ctx.profileId,
      }).returning();
      return created;
    });
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      countryIso2: country.iso2, action: 'EMPLOYMENT_OFFER_SENT',
      entityType: 'employment_offer', entityId: offer.id,
      details: { applicationId, version: offer.version, salaryCurrency: offer.salaryCurrency },
    });
    await notifyEmploymentCandidate(application.candidateProfileId, {
      type: 'EMPLOYMENT_OFFER_SENT', eventKey: `employment:offer-sent:${offer.id}`,
      titleFr: 'Proposition d’embauche reçue', titleEn: 'Employment offer received', titleAr: 'تلقيت عرض عمل', titlePt: 'Recebeu uma proposta de emprego',
      bodyFr: `Vous avez reçu une proposition pour « ${job.title} ». Répondez avant le ${expiresAt.toLocaleDateString('fr-FR')}.`,
      bodyEn: `You received an offer for “${job.title}”. Respond by ${expiresAt.toLocaleDateString('en-GB')}.`,
      bodyAr: `تلقيت عرض عمل لوظيفة « ${job.title} ». يرجى الرد قبل ${expiresAt.toLocaleDateString('en-GB')}.`,
      bodyPt: `Recebeu uma proposta para « ${job.title} ». Responda até ${expiresAt.toLocaleDateString('pt-PT')}.`,
    });
    res.status(201).json({ offer });
  } catch (err) {
    console.error('Create employment offer error:', err);
    res.status(500).json({ error: 'Unable to create employment offer' });
  }
});

app.get('/api/employment/me/offers', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const [candidate] = await db.select({ id: candidateProfiles.id })
      .from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) return res.json({ offers: [] });
    const now = new Date();
    await db.update(employmentOffers).set({ status: 'EXPIRED', updatedAt: now })
      .where(and(eq(employmentOffers.candidateProfileId, candidate.id), eq(employmentOffers.status, 'SENT'), sql`${employmentOffers.expiresAt} < ${now}`));
    const offers = await db.select({
      offer: employmentOffers, organizationName: organizations.name,
      countryName: countries.nameFr,
    }).from(employmentOffers)
      .innerJoin(organizations, eq(employmentOffers.organizationId, organizations.id))
      .innerJoin(countries, eq(employmentOffers.countryId, countries.id))
      .where(eq(employmentOffers.candidateProfileId, candidate.id))
      .orderBy(desc(employmentOffers.createdAt)).limit(50);
    res.json({ offers: offers.map((row) => ({ ...row.offer, organizationName: row.organizationName, countryName: row.countryName })) });
  } catch (err) {
    console.error('Candidate employment offers error:', err);
    res.status(500).json({ error: 'Unable to load employment offers' });
  }
});

app.patch('/api/employment/offers/:id/response', requireAuth, rateLimit(10, 60_000), async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const offerId = String(req.params.id);
    const response = String(req.body?.response || '').toUpperCase();
    const responseNote = req.body?.note == null ? null : String(req.body.note).trim().slice(0, 1000);
    if (!isValidUuid(offerId) || !['ACCEPTED', 'DECLINED'].includes(response)) {
      return res.status(400).json({ error: 'Invalid offer response' });
    }
    const [candidate] = await db.select({ id: candidateProfiles.id })
      .from(candidateProfiles).where(eq(candidateProfiles.profileId, ctx.profileId)).limit(1);
    if (!candidate) return res.status(404).json({ error: 'Offer not found' });
    const [current] = await db.select().from(employmentOffers).where(and(
      eq(employmentOffers.id, offerId), eq(employmentOffers.candidateProfileId, candidate.id)
    )).limit(1);
    if (!current) return res.status(404).json({ error: 'Offer not found' });
    if (current.status !== 'SENT') return res.status(409).json({ error: 'This offer is no longer awaiting a response' });
    if (current.expiresAt.getTime() <= Date.now()) {
      await db.update(employmentOffers).set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(and(eq(employmentOffers.id, offerId), eq(employmentOffers.status, 'SENT')));
      return res.status(409).json({ error: 'This offer has expired' });
    }
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(employmentOffers).set({
        status: response, candidateResponseAt: new Date(), candidateResponseNote: responseNote, updatedAt: new Date(),
      }).where(and(
        eq(employmentOffers.id, offerId), eq(employmentOffers.candidateProfileId, candidate.id),
        eq(employmentOffers.status, 'SENT'), gte(employmentOffers.expiresAt, new Date())
      )).returning();
      if (!updated) throw new Error('Offer was updated concurrently or has expired');
      if (response === 'ACCEPTED') {
        const [application] = await tx.update(jobApplications).set({ status: 'HIRED', updatedAt: new Date() })
          .where(and(eq(jobApplications.id, current.applicationId), eq(jobApplications.status, 'OFFER'))).returning();
        if (!application) throw new Error('Application is no longer awaiting an offer decision');
        await tx.insert(jobApplicationEvents).values({
          applicationId: current.applicationId, actorProfileId: ctx.profileId,
          fromStatus: 'OFFER', toStatus: 'HIRED', note: 'Candidate accepted employment offer',
        });
      }
    });
    await db.insert(auditLogs).values({
      actorProfileId: ctx.profileId, actorUid: ctx.uid, actorRole: ctx.activeRole,
      action: response === 'ACCEPTED' ? 'EMPLOYMENT_OFFER_ACCEPTED' : 'EMPLOYMENT_OFFER_DECLINED',
      entityType: 'employment_offer', entityId: offerId,
      details: { applicationId: current.applicationId, version: current.version },
    });
    await notifyEmploymentOrganization(current.organizationId, {
      type: `EMPLOYMENT_OFFER_${response}`, eventKey: `employment:offer-response:${offerId}:${response}`,
      titleFr: response === 'ACCEPTED' ? 'Proposition acceptée' : 'Proposition refusée',
      titleEn: response === 'ACCEPTED' ? 'Offer accepted' : 'Offer declined',
      titleAr: response === 'ACCEPTED' ? 'تم قبول العرض' : 'تم رفض العرض',
      titlePt: response === 'ACCEPTED' ? 'Proposta aceite' : 'Proposta recusada',
      bodyFr: `Le candidat a ${response === 'ACCEPTED' ? 'accepté' : 'refusé'} la proposition pour « ${current.jobTitleSnapshot} ».`,
      bodyEn: `The candidate has ${response === 'ACCEPTED' ? 'accepted' : 'declined'} the offer for “${current.jobTitleSnapshot}”.`,
      bodyAr: `قام المرشح ${response === 'ACCEPTED' ? 'بقبول' : 'برفض'} العرض لوظيفة « ${current.jobTitleSnapshot} ».`,
      bodyPt: `O candidato ${response === 'ACCEPTED' ? 'aceitou' : 'recusou'} a proposta para « ${current.jobTitleSnapshot} ».`,
    });
    res.json({ success: true, response });
  } catch (err: any) {
    if (String(err?.message || '').includes('concurrently') || String(err?.message || '').includes('no longer awaiting')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('Respond to employment offer error:', err);
    res.status(500).json({ error: 'Unable to save offer response' });
  }
});

app.get('/api/opportunities', async (req, res) => {
  try {
    const countryFilter = req.query.countryIso2 ? String(req.query.countryIso2).toUpperCase() : 'ALL';
    const domainFilter = req.query.domain ? String(req.query.domain).toLowerCase() : 'ALL';
    const typeFilter = req.query.type ? String(req.query.type).toUpperCase() : 'ALL';
    const searchQ = req.query.q ? String(req.query.q).trim().toLowerCase() : '';

    // 1. Live open public missions in ACTIVE/TESTING countries (anonymized, no client PII/exact street address)
    const liveMissions = await db
      .select({
        mission: missions,
        category: serviceCategories,
        country: countries,
      })
      .from(missions)
      .innerJoin(serviceCategories, eq(missions.categoryId, serviceCategories.id))
      .innerJoin(countries, eq(missions.countryId, countries.id))
      .where(
        and(
          inArray(missions.status, ['REQUESTED', 'QUOTED']),
          inArray(countries.status, ['ACTIVE', 'TESTING'])
        )
      )
      .orderBy(desc(missions.createdAt))
      .limit(20);

    const missionOpps = liveMissions.map((row) => ({
      id: row.mission.id,
      type: 'MISSION',
      domain: row.category.slug,
      domainLabelFr: row.category.nameFr,
      domainLabelEn: row.category.nameEn,
      domainLabelPt: row.category.namePt || row.category.nameEn,
      domainLabelAr: row.category.nameAr,
      countryIso2: row.country.iso2,
      city: row.mission.city,
      titleFr: row.mission.title,
      titleEn: row.mission.title,
      titlePt: row.mission.title,
      titleAr: row.mission.title,
      summaryFr: `Budget indicatif : ${row.mission.estimatedBudget ? `${row.mission.estimatedBudget} ${row.mission.currency}` : 'Sur devis'} · Créneau souhaité : ${row.mission.desiredDate}`,
      summaryEn: `Indicative budget: ${row.mission.estimatedBudget ? `${row.mission.estimatedBudget} ${row.mission.currency}` : 'Quote-based'} · Preferred date: ${row.mission.desiredDate}`,
      summaryPt: `Orçamento indicativo: ${row.mission.estimatedBudget ? `${row.mission.estimatedBudget} ${row.mission.currency}` : 'Por orçamento'} · Data pretendida: ${row.mission.desiredDate}`,
      summaryAr: `الميزانية التقديرية: ${row.mission.estimatedBudget ? `${row.mission.estimatedBudget} ${row.mission.currency}` : 'حسب عرض السعر'} · الموعد: ${row.mission.desiredDate}`,
      organizationName: `Mission ${row.mission.referenceCode}`,
      referenceCode: row.mission.referenceCode,
      isLiveMission: true,
      isPilotProgram: false,
      targetPath: '/pro-space',
    }));

    // 2. Structured pilot opportunities (jobs, partnerships, collaborations, entrepreneurship)
    const [oppSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'home_opportunities'))
      .limit(1);

    const curated = Array.isArray((oppSetting?.value as any)?.items)
      ? ((oppSetting!.value as any).items as any[]).map((o) => ({
          ...o,
          isLiveMission: false,
          isPilotProgram: o.isPilotProgram !== false,
          targetPath: o.domain === 'education_training' ? '/skills' : '/contact',
        }))
      : [];

    const combined = [...missionOpps, ...curated].filter((item) => {
      if (countryFilter !== 'ALL' && String(item.countryIso2).toUpperCase() !== countryFilter) return false;
      if (typeFilter !== 'ALL' && String(item.type).toUpperCase() !== typeFilter) return false;
      if (domainFilter !== 'ALL' && String(item.domain).toLowerCase() !== domainFilter) return false;
      if (searchQ) {
        const hay = [item.titleFr, item.titleEn, item.city, item.organizationName, item.domain]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }
      return true;
    });

    res.json({ opportunities: combined, total: combined.length });
  } catch (err) {
    console.error('Error loading opportunities:', err);
    res.status(500).json({ error: 'Failed to load opportunities' });
  }
});

app.post('/api/contact', rateLimit(15, 60_000), async (req, res) => {
  try {
    const { name, email, countryIso2, subject, message } = req.body || {};
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'name, email, subject, and message are required' });
    }
    const cleanEmail = String(email).trim();
    if (!cleanEmail.includes('@') || cleanEmail.length > 160) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    const cleanIso = countryIso2 ? String(countryIso2).toUpperCase().slice(0, 2) : 'CI';
    const refId = `CNT-${Date.now().toString(36).toUpperCase()}`;

    await db.insert(auditLogs).values({
      actorUid: 'PUBLIC_CONTACT',
      actorRole: 'GUEST',
      countryIso2: cleanIso,
      action: 'PUBLIC_CONTACT_INQUIRY',
      entityType: 'contact_message',
      entityId: refId,
      details: {
        name: String(name).trim().slice(0, 120),
        email: cleanEmail,
        subject: String(subject).trim().slice(0, 180),
        message: String(message).trim().slice(0, 2000),
      },
    });

    res.status(201).json({ received: true, referenceCode: refId });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Failed to record contact inquiry' });
  }
});

app.get('/api/professionals', async (req, res) => {
  try {
    const { countryIso2, category, city, q, verifiedOnly, availableToday } = req.query;
    const conditions = [];
    if (countryIso2 && String(countryIso2).toUpperCase() !== 'ALL') {
      conditions.push(eq(countries.iso2, String(countryIso2).toUpperCase()));
    }
    if (category && category !== 'all') {
      const slugs = String(category)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (slugs.length === 1) {
        conditions.push(eq(professionals.primaryCategorySlug, slugs[0]));
      } else if (slugs.length > 1) {
        conditions.push(inArray(professionals.primaryCategorySlug, slugs));
      }
    }
    if (city) {
      conditions.push(ilike(professionals.city, `%${String(city).trim()}%`));
    }
    if (verifiedOnly === 'true') {
      conditions.push(eq(professionals.isVerified, true));
    }
    if (availableToday === 'true') {
      conditions.push(eq(professionals.availableToday, true));
    }

    const rows = await db
      .select({
        pro: professionals,
        profile: profiles,
        country: countries,
      })
      .from(professionals)
      .innerJoin(profiles, eq(professionals.profileId, profiles.id))
      .innerJoin(countries, eq(professionals.countryId, countries.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(professionals.isVerified), desc(professionals.ratingAvg));

    const matchedByQuery = q
      ? rows.filter((r) => {
          const term = String(q).toLowerCase();
          const matchText = [
            r.profile.fullName,
            r.pro.headlineFr,
            r.pro.headlineEn,
            r.pro.headlinePt || '',
            r.pro.headlineAr,
            r.pro.city,
            r.pro.neighborhood,
            r.pro.primaryCategorySlug,
          ]
            .join(' ')
            .toLowerCase();
          return matchText.includes(term);
        })
      : rows;

    const proIds = matchedByQuery.map((r) => r.pro.id);
    const scopedSkills =
      proIds.length > 0
        ? await db
            .select({
              professionalId: professionalSkills.professionalId,
              level: professionalSkills.level,
              verifiedByKazi: professionalSkills.verifiedByKazi,
              skill: skills,
            })
            .from(professionalSkills)
            .innerJoin(skills, eq(professionalSkills.skillId, skills.id))
            .where(inArray(professionalSkills.professionalId, proIds))
        : [];

    const scopedServices =
      proIds.length > 0
        ? await db
            .select()
            .from(professionalServices)
            .where(inArray(professionalServices.professionalId, proIds))
        : [];

    const filtered = matchedByQuery.map((r) => ({
      ...r.pro,
      fullName: r.profile.fullName,
      countryIso2: r.country.iso2,
      countryNameFr: r.country.nameFr,
      skills: scopedSkills.filter((s) => s.professionalId === r.pro.id),
      services: scopedServices.filter((sv) => sv.professionalId === r.pro.id),
    }));

    res.json({ professionals: filtered });
  } catch (err) {
    console.error('Error fetching professionals:', err);
    res.status(500).json({ error: 'Failed to load professionals' });
  }
});

app.get('/api/professionals/:id', async (req, res) => {
  try {
    const proId = req.params.id;
    if (!isValidUuid(proId)) {
      return res.status(400).json({ error: 'Invalid identifier format' });
    }
    const rows = await db
      .select({
        pro: professionals,
        profile: profiles,
        country: countries,
      })
      .from(professionals)
      .innerJoin(profiles, eq(professionals.profileId, profiles.id))
      .innerJoin(countries, eq(professionals.countryId, countries.id))
      .where(eq(professionals.id, proId))
      .limit(1);

    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Professional not found' });

    const proSkills = await db
      .select({
        level: professionalSkills.level,
        verifiedByKazi: professionalSkills.verifiedByKazi,
        skill: skills,
      })
      .from(professionalSkills)
      .innerJoin(skills, eq(professionalSkills.skillId, skills.id))
      .where(eq(professionalSkills.professionalId, proId));

    const services = await db
      .select()
      .from(professionalServices)
      .where(eq(professionalServices.professionalId, proId));

    const proReviews = await db
      .select({
        review: reviews,
        authorName: profiles.fullName,
      })
      .from(reviews)
      .innerJoin(profiles, eq(reviews.authorProfileId, profiles.id))
      .where(eq(reviews.professionalId, proId))
      .orderBy(desc(reviews.createdAt));

    res.json({
      professional: {
        ...row.pro,
        fullName: row.profile.fullName,
        countryIso2: row.country.iso2,
        skills: proSkills,
        services,
        reviews: proReviews.map((rv) => ({ ...rv.review, authorName: rv.authorName })),
      },
    });
  } catch (err) {
    console.error('Error fetching professional detail:', err);
    res.status(500).json({ error: 'Failed to load professional profile' });
  }
});

app.post('/api/professionals/register', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const {
      countryIso2,
      primaryCategorySlug,
      headlineFr,
      headlineEn,
      headlinePt,
      headlineAr,
      bioFr,
      bioEn,
      bioPt,
      bioAr,
      yearsExperience,
      hourlyRate,
      city,
      neighborhood,
    } = req.body || {};

    const iso2 = String(countryIso2 || ctx.countryIso2).toUpperCase();
    const [country] = await db.select().from(countries).where(eq(countries.iso2, iso2)).limit(1);
    if (!country) return res.status(400).json({ error: 'Invalid country' });

    const [deployment] = await db
      .select()
      .from(countryDeployments)
      .where(eq(countryDeployments.countryId, country.id))
      .limit(1);

    const isSuperAdmin = ctx.roles.includes('SUPER_ADMIN');
    if (
      !isSuperAdmin &&
      ((country.status !== 'ACTIVE' && country.status !== 'TESTING') || !deployment?.registrationsOpen)
    ) {
      return res.status(403).json({
        error: `Professional registrations are not open in ${country.nameFr} (status: ${country.status})`,
      });
    }

    const parsedExp = yearsExperience !== undefined ? Number(yearsExperience) : undefined;
    if (parsedExp !== undefined && (!Number.isFinite(parsedExp) || parsedExp < 0 || parsedExp > 70)) {
      return res.status(400).json({ error: 'Invalid years of experience' });
    }
    const parsedRate = hourlyRate !== undefined ? Number(hourlyRate) : undefined;
    if (parsedRate !== undefined && (!Number.isFinite(parsedRate) || parsedRate <= 0)) {
      return res.status(400).json({ error: 'Hourly rate must be a positive number' });
    }

    // Security rule: NEVER let a professional self-verify!
    const existing = await db
      .select()
      .from(professionals)
      .where(eq(professionals.profileId, ctx.profileId))
      .limit(1);

    let proRecord;
    if (existing[0]) {
      const [updated] = await db
        .update(professionals)
        .set({
          primaryCategorySlug: primaryCategorySlug ? String(primaryCategorySlug).slice(0, 60) : existing[0].primaryCategorySlug,
          headlineFr: headlineFr ? String(headlineFr).slice(0, 140) : existing[0].headlineFr,
          headlineEn: headlineEn ? String(headlineEn).slice(0, 140) : existing[0].headlineEn,
          headlinePt: headlinePt ? String(headlinePt).slice(0, 140) : existing[0].headlinePt,
          headlineAr: headlineAr ? String(headlineAr).slice(0, 140) : existing[0].headlineAr,
          bioFr: bioFr ? String(bioFr).slice(0, 2000) : existing[0].bioFr,
          bioEn: bioEn ? String(bioEn).slice(0, 2000) : existing[0].bioEn,
          bioPt: bioPt ? String(bioPt).slice(0, 2000) : existing[0].bioPt,
          bioAr: bioAr ? String(bioAr).slice(0, 2000) : existing[0].bioAr,
          yearsExperience: parsedExp !== undefined ? Math.round(parsedExp) : existing[0].yearsExperience,
          hourlyRate: parsedRate !== undefined ? parsedRate.toFixed(2) : existing[0].hourlyRate,
          city: city ? String(city).slice(0, 80) : existing[0].city,
          neighborhood: neighborhood ? String(neighborhood).slice(0, 80) : existing[0].neighborhood,
        })
        .where(eq(professionals.id, existing[0].id))
        .returning();
      proRecord = updated;
    } else {
      const [inserted] = await db
        .insert(professionals)
        .values({
          profileId: ctx.profileId,
          countryId: country.id,
          primaryCategorySlug: String(primaryCategorySlug || 'electricity').slice(0, 60),
          headlineFr: String(headlineFr || 'Professionnel indépendant KAZI').slice(0, 140),
          headlineEn: String(headlineEn || 'Independent KAZI Professional').slice(0, 140),
          headlinePt: String(headlinePt || headlineEn || 'Profissional Independente KAZI').slice(0, 140),
          headlineAr: String(headlineAr || 'مهني مستقل كازي').slice(0, 140),
          bioFr: String(bioFr || 'Profil en attente de vérification documentaire.').slice(0, 2000),
          bioEn: String(bioEn || 'Profile pending document verification.').slice(0, 2000),
          bioPt: String(bioPt || bioEn || 'Perfil a aguardar verificação documental.').slice(0, 2000),
          bioAr: String(bioAr || 'الملف الشخصي قيد التحقق.').slice(0, 2000),
          yearsExperience: parsedExp !== undefined ? Math.round(parsedExp) : 2,
          hourlyRate: (parsedRate !== undefined ? parsedRate : 25).toFixed(2),
          currency: country.defaultCurrency,
          city: String(city || country.capital).slice(0, 80),
          neighborhood: String(neighborhood || 'Centre').slice(0, 80),
          isVerified: false, // Hardcoded server-side
          isProSubscriber: false,
        })
        .returning();
      proRecord = inserted;

      await grantUserRoleSafely({
        profileId: ctx.profileId,
        role: 'PROFESSIONAL',
        countryIso2: null,
        grantedBy: 'SELF_ONBOARD',
      });
    }

    res.json({ professional: proRecord });
  } catch (err) {
    console.error('Error registering professional:', err);
    res.status(500).json({ error: 'Failed to save professional profile' });
  }
});

app.post('/api/professionals/me/verifications', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const [pro] = await db
      .select()
      .from(professionals)
      .where(eq(professionals.profileId, ctx.profileId))
      .limit(1);
    if (!pro) return res.status(404).json({ error: 'Professional profile not found' });

    const { docType, documentName } = req.body || {};
    if (!docType || !documentName) {
      return res.status(400).json({ error: 'docType and documentName are required' });
    }

    const [created] = await db
      .insert(verifications)
      .values({
        professionalId: pro.id,
        docType: String(docType).slice(0, 40),
        documentName: String(documentName).slice(0, 120),
        documentStorageRef: `kazi-vault/${ctx.countryIso2.toLowerCase()}/${Date.now()}.pdf`,
        status: 'PENDING',
      })
      .returning();

    res.status(201).json({ verification: created });
  } catch (err) {
    console.error('Error submitting verification:', err);
    res.status(500).json({ error: 'Failed to submit verification document' });
  }
});

// ============================================================================
// 4. MISSIONS, QUOTES, BOOKINGS & STATE MACHINE
// ============================================================================

app.get('/api/missions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const allMissions = await db
      .select({
        mission: missions,
        category: serviceCategories,
        country: countries,
      })
      .from(missions)
      .innerJoin(serviceCategories, eq(missions.categoryId, serviceCategories.id))
      .innerJoin(countries, eq(missions.countryId, countries.id))
      .orderBy(desc(missions.createdAt));

    const [myPro] = await db
      .select()
      .from(professionals)
      .where(eq(professionals.profileId, ctx.profileId))
      .limit(1);

    const myOrgLinks = await db
      .select({ organizationId: orgMembers.organizationId })
      .from(orgMembers)
      .where(eq(orgMembers.profileId, ctx.profileId));
    const myOrgIds = new Set(myOrgLinks.map((o) => o.organizationId));

    const visible = allMissions.filter((m) => {
      if (ctx.roles.includes('SUPER_ADMIN')) return true;
      if (ctx.roles.includes('LOCAL_ADMIN') && ctx.adminCountryIso2s.includes(m.country.iso2)) return true;
      if (m.mission.clientProfileId === ctx.profileId) return true;
      if (m.mission.organizationId && myOrgIds.has(m.mission.organizationId)) return true;
      if (myPro && m.mission.targetProfessionalId === myPro.id) return true;
      if (myPro && m.mission.status === 'REQUESTED' && m.mission.countryId === myPro.countryId) return true;
      return false;
    });

    const visibleIds = visible.map((v) => v.mission.id);
    const scopedQuotes =
      visibleIds.length > 0 ? await db.select().from(quotes).where(inArray(quotes.missionId, visibleIds)) : [];
    const scopedBookings =
      visibleIds.length > 0 ? await db.select().from(bookings).where(inArray(bookings.missionId, visibleIds)) : [];
    const bookingIds = scopedBookings.map((b) => b.id);
    const scopedPayments =
      bookingIds.length > 0 ? await db.select().from(payments).where(inArray(payments.bookingId, bookingIds)) : [];

    res.json({
      missions: visible.map((m) => {
        const missionQuotes = scopedQuotes.filter((q) => q.missionId === m.mission.id);
        const missionBooking = scopedBookings.find((b) => b.missionId === m.mission.id) || null;
        const bookingPayment = missionBooking
          ? scopedPayments.find((p) => p.bookingId === missionBooking.id) || null
          : null;
        return {
          ...m.mission,
          category: m.category,
          countryIso2: m.country.iso2,
          quotes: missionQuotes,
          booking: missionBooking,
          payment: bookingPayment,
        };
      }),
    });
  } catch (err) {
    console.error('Error loading missions:', err);
    res.status(500).json({ error: 'Failed to load missions' });
  }
});

app.post('/api/missions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const {
      countryIso2,
      categorySlug,
      targetProfessionalId,
      title,
      description,
      address,
      city,
      desiredDate,
      timeSlot,
      estimatedBudget,
      organizationId,
    } = req.body || {};

    if (!description || !address || !desiredDate || !timeSlot) {
      return res.status(400).json({ error: 'Missing required mission fields' });
    }

    if (estimatedBudget !== undefined && estimatedBudget !== null && estimatedBudget !== '') {
      const budget = Number(estimatedBudget);
      if (!Number.isFinite(budget) || budget <= 0) {
        return res.status(400).json({ error: 'Estimated budget must be a positive number' });
      }
    }

    const iso2 = String(countryIso2 || ctx.countryIso2).toUpperCase();
    const [country] = await db.select().from(countries).where(eq(countries.iso2, iso2)).limit(1);
    if (!country) return res.status(400).json({ error: 'Country not found' });

    const [deployment] = await db
      .select()
      .from(countryDeployments)
      .where(eq(countryDeployments.countryId, country.id))
      .limit(1);

    if ((country.status !== 'ACTIVE' && country.status !== 'TESTING') || !deployment?.missionsOpen) {
      return res.status(403).json({
        error: `Missions are not yet open in ${country.nameFr} (status: ${country.status})`,
      });
    }

    if (organizationId) {
      if (!isValidUuid(organizationId)) {
        return res.status(400).json({ error: 'Invalid organization identifier' });
      }
      const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      const [member] = await db
        .select()
        .from(orgMembers)
        .where(and(eq(orgMembers.organizationId, org.id), eq(orgMembers.profileId, ctx.profileId)))
        .limit(1);
      if (org.ownerProfileId !== ctx.profileId && !member && !ctx.roles.includes('SUPER_ADMIN')) {
        return res.status(403).json({ error: 'IDOR protection: you are not a member of this organization' });
      }
    }

    if (targetProfessionalId) {
      if (!isValidUuid(targetProfessionalId)) {
        return res.status(400).json({ error: 'Invalid target professional identifier' });
      }
      const [targetPro] = await db
        .select()
        .from(professionals)
        .where(eq(professionals.id, targetProfessionalId))
        .limit(1);
      if (!targetPro) return res.status(404).json({ error: 'Target professional not found' });
      if (targetPro.countryId !== country.id) {
        return res.status(400).json({ error: 'Target professional operates in a different country' });
      }
    }

    const [cat] = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.slug, String(categorySlug || 'electricity')))
      .limit(1);
    if (!cat) return res.status(400).json({ error: 'Invalid service category' });

    const refCode = `KZ-2026-${Math.floor(10000 + Math.random() * 89999)}`;
    const [created] = await db
      .insert(missions)
      .values({
        referenceCode: refCode,
        countryId: country.id,
        clientProfileId: ctx.profileId,
        organizationId: organizationId || null,
        categoryId: cat.id,
        targetProfessionalId: targetProfessionalId || null,
        title: String(title || String(description).slice(0, 65)).slice(0, 140),
        description: String(description).slice(0, 2000),
        address: String(address).slice(0, 300),
        city: String(city || country.capital).slice(0, 80),
        desiredDate: String(desiredDate).slice(0, 32),
        timeSlot: String(timeSlot).slice(0, 32),
        estimatedBudget: estimatedBudget ? Number(estimatedBudget).toFixed(2) : null,
        currency: country.defaultCurrency,
        status: 'REQUESTED',
      })
      .returning();

    res.status(201).json({ mission: created });
  } catch (err) {
    console.error('Error creating mission:', err);
    res.status(500).json({ error: 'Failed to create mission' });
  }
});

app.post('/api/missions/:id/quotes', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const missionId = req.params.id;
    if (!isValidUuid(missionId)) {
      return res.status(400).json({ error: 'Invalid mission identifier' });
    }
    const { amount, scopeDetails, estimatedDuration } = req.body || {};

    const [pro] = await db
      .select()
      .from(professionals)
      .where(eq(professionals.profileId, ctx.profileId))
      .limit(1);

    const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    if (!['REQUESTED', 'QUOTED'].includes(mission.status)) {
      return res.status(409).json({ error: `Mission in status ${mission.status} is no longer accepting quotes` });
    }

    let actingPro = pro;
    if (!actingPro && ctx.roles.includes('SUPER_ADMIN')) {
      const [sameCountryPro] = await db
        .select()
        .from(professionals)
        .where(eq(professionals.countryId, mission.countryId))
        .limit(1);
      actingPro = sameCountryPro;
    }
    if (!actingPro) return res.status(403).json({ error: 'Professional account required to send quotes' });

    if (actingPro.countryId !== mission.countryId && !ctx.roles.includes('SUPER_ADMIN')) {
      return res.status(403).json({ error: 'Cross-country quoting is not permitted' });
    }

    if (
      mission.targetProfessionalId &&
      mission.targetProfessionalId !== actingPro.id &&
      !ctx.roles.includes('SUPER_ADMIN')
    ) {
      return res.status(403).json({ error: 'This mission is assigned to another professional' });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Valid positive quote amount required' });
    }

    const [quote] = await db
      .insert(quotes)
      .values({
        missionId: mission.id,
        professionalId: actingPro.id,
        amount: numericAmount.toFixed(2),
        currency: mission.currency,
        scopeDetails: String(scopeDetails || 'Intervention standard et contrôle sécurité').slice(0, 1500),
        estimatedDuration: String(estimatedDuration || '2h00').slice(0, 60),
        status: 'PENDING',
      })
      .returning();

    await db
      .update(missions)
      .set({ status: 'QUOTED', updatedAt: new Date() })
      .where(eq(missions.id, mission.id));

    res.status(201).json({ quote });
  } catch (err) {
    console.error('Error creating quote:', err);
    res.status(500).json({ error: 'Failed to submit quote' });
  }
});

app.post('/api/quotes/:id/accept', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const quoteId = req.params.id;
    if (!isValidUuid(quoteId)) {
      return res.status(400).json({ error: 'Invalid quote identifier' });
    }

    const result = await db.transaction(async (tx) => {
      const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
      if (!quote) return { status: 404 as const, body: { error: 'Quote not found' } };

      if (quote.status !== 'PENDING') {
        return { status: 409 as const, body: { error: `Quote already processed (${quote.status})` } };
      }

      const [mission] = await tx.select().from(missions).where(eq(missions.id, quote.missionId)).limit(1);
      if (!mission) return { status: 404 as const, body: { error: 'Mission not found' } };

      if (mission.clientProfileId !== ctx.profileId && !ctx.roles.includes('SUPER_ADMIN')) {
        return { status: 403 as const, body: { error: 'Only mission owner can accept this quote' } };
      }

      const [claimedMission] = await tx
        .update(missions)
        .set({ status: 'ACCEPTED', updatedAt: new Date() })
        .where(and(eq(missions.id, mission.id), inArray(missions.status, ['REQUESTED', 'QUOTED'])))
        .returning();

      if (!claimedMission) {
        return { status: 409 as const, body: { error: `Mission already in status ${mission.status}` } };
      }

      const [existingBooking] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.missionId, mission.id))
        .limit(1);
      if (existingBooking) {
        return { status: 409 as const, body: { error: 'Booking already exists for this mission' } };
      }

      await tx.update(quotes).set({ status: 'REJECTED' }).where(eq(quotes.missionId, mission.id));
      const [acceptedQuote] = await tx
        .update(quotes)
        .set({ status: 'ACCEPTED' })
        .where(and(eq(quotes.id, quote.id)))
        .returning();

      if (!acceptedQuote) {
        return { status: 409 as const, body: { error: 'Quote no longer available' } };
      }

      const start = new Date();
      const end = new Date(start.getTime() + 2 * 3600 * 1000);
      const [booking] = await tx
        .insert(bookings)
        .values({
          bookingNumber: mission.referenceCode,
          missionId: mission.id,
          quoteId: quote.id,
          clientProfileId: mission.clientProfileId,
          professionalId: quote.professionalId,
          countryId: mission.countryId,
          agreedAmount: quote.amount,
          currency: quote.currency,
          scheduledStart: start,
          scheduledEnd: end,
          status: 'CONFIRMED',
        })
        .returning();

      await tx.insert(bookingStatusHistory).values({
        bookingId: booking.id,
        fromStatus: null,
        toStatus: 'CONFIRMED',
        actorUid: ctx.uid,
        note: 'Devis accepté par le client',
      });

      return { status: 201 as const, body: { booking } };
    });

    return res.status(result.status).json(result.body);
  } catch (err: any) {
    if (isPgUniqueViolation(err)) {
      return res.status(409).json({ error: 'Booking already exists for this mission' });
    }
    console.error('Error accepting quote:', err);
    res.status(500).json({ error: 'Failed to accept quote' });
  }
});

app.post('/api/bookings/:id/transition', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const bookingId = req.params.id;
    if (!isValidUuid(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking identifier' });
    }
    const { toStatus, note } = req.body || {};

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const [pro] = await db
      .select()
      .from(professionals)
      .where(eq(professionals.id, booking.professionalId))
      .limit(1);

    const [country] = await db.select().from(countries).where(eq(countries.id, booking.countryId)).limit(1);

    const isOwner = booking.clientProfileId === ctx.profileId;
    const isAssignedPro = pro?.profileId === ctx.profileId;
    const isCountryAdmin =
      ctx.roles.includes('SUPER_ADMIN') ||
      (ctx.roles.includes('LOCAL_ADMIN') && !!country && ctx.adminCountryIso2s.includes(country.iso2));

    const actorCheck = canActorTransitionBooking({
      toStatus: String(toStatus),
      isClientOwner: isOwner,
      isAssignedPro,
      isCountryAdmin,
    });

    if (!actorCheck.allowed) {
      return res.status(403).json({ error: actorCheck.reason || 'Access denied for this booking' });
    }

    const updated = await transitionBookingStatus({
      bookingId,
      toStatus: String(toStatus),
      actorUid: ctx.uid,
      actorRole: ctx.activeRole,
      note: note ? String(note).slice(0, 400) : undefined,
    });

    res.json({ booking: updated });
  } catch (err: any) {
    console.error('Booking transition error:', err);
    res.status(400).json({ error: err.message || 'Invalid booking transition' });
  }
});

// ============================================================================
// 5. PAYMENTS, SIGNED WEBHOOKS, COMMISSIONS & REFUNDS
// ============================================================================

app.post('/api/payments/initiate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const { bookingId, providerCode, idempotencyKey } = req.body || {};

    if (!bookingId || !providerCode || !idempotencyKey) {
      return res.status(400).json({ error: 'bookingId, providerCode, and idempotencyKey are required' });
    }
    if (!isValidUuid(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking identifier' });
    }

    // Idempotency guard (with payer ownership check)
    const existing = await db
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, String(idempotencyKey)))
      .limit(1);
    if (existing[0]) {
      if (existing[0].payerProfileId !== ctx.profileId && !ctx.roles.includes('SUPER_ADMIN')) {
        return res.status(403).json({ error: 'IDOR protection: idempotency key belongs to another account' });
      }
      return res.json({ payment: existing[0], idempotentReplay: true });
    }

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, String(bookingId))).limit(1);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    if (booking.clientProfileId !== ctx.profileId && !ctx.roles.includes('SUPER_ADMIN')) {
      return res.status(403).json({ error: 'IDOR protection: booking does not belong to you' });
    }
    if (booking.status === 'CANCELLED') {
      return res.status(409).json({ error: 'Cannot initiate payment for a cancelled booking' });
    }

    const existingBookingPayments = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id));
    if (existingBookingPayments.some((p) => p.status === 'CONFIRMED_SERVER' || p.status === 'REFUNDED')) {
      return res.status(409).json({ error: 'Payment already completed for this booking' });
    }

    const [country] = await db.select().from(countries).where(eq(countries.id, booking.countryId)).limit(1);
    const [provider] = await db
      .select()
      .from(countryPaymentProviders)
      .where(
        and(
          eq(countryPaymentProviders.countryId, booking.countryId),
          eq(countryPaymentProviders.providerCode, String(providerCode))
        )
      )
      .limit(1);

    if (!provider || (provider.status !== 'VERIFIED_ACTIVE' && provider.status !== 'SANDBOX')) {
      return res.status(400).json({ error: 'Payment provider is not enabled or verified for this country' });
    }

    const ratePct = Number(country?.commissionRatePct ?? '10.00');
    const split = calculateCommissionSplit(Number(booking.agreedAmount), ratePct);

    const [created] = await db
      .insert(payments)
      .values({
        bookingId: booking.id,
        countryId: booking.countryId,
        payerProfileId: ctx.profileId,
        amountGross: booking.agreedAmount,
        commissionAmount: split.commissionAmount,
        netToProfessional: split.netToProfessional,
        currency: booking.currency,
        providerCode: String(providerCode),
        idempotencyKey: String(idempotencyKey).slice(0, 120),
        status: 'PENDING_CONFIRMATION',
      })
      .returning();

    await db.insert(paymentTransactions).values({
      paymentId: created.id,
      eventType: 'INIT',
      payload: { providerCode, amountGross: booking.agreedAmount, currency: booking.currency },
      signatureVerified: false,
    });

    res.status(201).json({
      payment: created,
      commissionRatePct: split.ratePct,
      providerMode: provider.status,
    });
  } catch (err: any) {
    if (isPgUniqueViolation(err) && req.body?.idempotencyKey) {
      const [existing] = await db
        .select()
        .from(payments)
        .where(eq(payments.idempotencyKey, String(req.body.idempotencyKey)))
        .limit(1);
      if (existing) {
        return res.status(200).json({ payment: existing, idempotentReplay: true });
      }
    }
    console.error('Payment initiation error:', err);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

// Signed webhook endpoint (PSP -> Server, verifies raw payload bytes & replay protection)
app.post('/api/payments/webhook', async (req: RawBodyRequest, res) => {
  try {
    if (!WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Webhook verification secret not configured' });
    }
    const signature = String(req.headers['x-kazi-signature'] || '');
    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || {});
    const timestampHeader = req.headers['x-kazi-timestamp'] ? String(req.headers['x-kazi-timestamp']).trim() : '';

    if (IS_PRODUCTION && !timestampHeader) {
      return res.status(401).json({ error: 'Missing X-Kazi-Timestamp header for replay protection' });
    }

    if (timestampHeader) {
      let tsMs = Number(timestampHeader);
      if (!Number.isFinite(tsMs)) {
        tsMs = Date.parse(timestampHeader);
      } else if (tsMs < 1e12) {
        tsMs *= 1000;
      }
      if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 300_000) {
        return res.status(401).json({ error: 'Webhook timestamp outside allowed 300s replay window' });
      }
    }

    const validRaw = verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET);
    const validTsBound = timestampHeader
      ? verifyWebhookSignature(`${timestampHeader}.${rawBody}`, signature, WEBHOOK_SECRET)
      : false;

    if (!validRaw && !validTsBound) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const now = Date.now();
    for (const [k, exp] of webhookReplayCache.entries()) {
      if (exp < now) webhookReplayCache.delete(k);
    }

    const deliveryId = req.headers['x-kazi-delivery-id'] ? String(req.headers['x-kazi-delivery-id']).trim() : '';
    const replayKey = deliveryId
      ? `deliv:${deliveryId}`
      : timestampHeader
      ? `sig:${timestampHeader}:${signature}`
      : '';

    const { paymentId, externalRef, status, amount, currency, reason } = req.body || {};
    if (paymentId && !isValidUuid(paymentId)) {
      return res.status(400).json({ error: 'Invalid paymentId format' });
    }

    if (replayKey && webhookReplayCache.has(replayKey)) {
      if (paymentId) {
        const [existingPayment] = await db
          .select()
          .from(payments)
          .where(eq(payments.id, String(paymentId)))
          .limit(1);
        return res.json({ received: true, idempotentReplay: true, payment: existingPayment || null });
      }
      return res.json({ received: true, idempotentReplay: true });
    }

    if (replayKey) {
      webhookReplayCache.set(replayKey, now + WEBHOOK_REPLAY_TTL_MS);
    }

    if (status === 'SUCCEEDED' && paymentId) {
      try {
        const [before] = await db.select().from(payments).where(eq(payments.id, String(paymentId))).limit(1);
        if (before && before.status === 'CONFIRMED_SERVER') {
          return res.json({ received: true, idempotentReplay: true, payment: before });
        }
        const updated = await confirmPaymentServerSide({
          paymentId: String(paymentId),
          externalRef: String(externalRef || `PSP-${Date.now()}`),
          signatureVerified: true,
          rawPayload: req.body,
          reportedAmount: amount !== undefined ? Number(amount) : undefined,
          reportedCurrency: currency ? String(currency) : undefined,
        });
        return res.json({ received: true, payment: updated });
      } catch (err: any) {
        return res.status(400).json({ error: err.message || 'Payment reconciliation validation failed' });
      }
    }

    if (status === 'FAILED' && paymentId) {
      try {
        const updated = await failPaymentServerSide({
          paymentId: String(paymentId),
          reason: String(reason || 'PSP reported failure'),
          signatureVerified: true,
          rawPayload: req.body,
        });
        return res.json({ received: true, payment: updated });
      } catch (err: any) {
        return res.status(400).json({ error: err.message || 'Payment failure recording failed' });
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Server-side Sandbox PSP confirmation (restricted strictly to SANDBOX providers)
app.post('/api/payments/:id/sandbox-confirm', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (IS_PRODUCTION && process.env.ALLOW_SANDBOX_PAYMENTS !== 'true') {
      return res.status(403).json({ error: 'Sandbox confirmation disabled in production' });
    }
    if (!WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Payment signing secret not configured' });
    }
    const ctx = req.authCtx!;
    const paymentId = req.params.id;
    if (!isValidUuid(paymentId)) {
      return res.status(400).json({ error: 'Invalid payment identifier' });
    }

    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    if (payment.payerProfileId !== ctx.profileId && !ctx.roles.includes('SUPER_ADMIN')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [provider] = await db
      .select()
      .from(countryPaymentProviders)
      .where(
        and(
          eq(countryPaymentProviders.countryId, payment.countryId),
          eq(countryPaymentProviders.providerCode, payment.providerCode)
        )
      )
      .limit(1);

    if (!provider || provider.status !== 'SANDBOX') {
      return res.status(403).json({ error: 'Sandbox confirmation is only permitted for SANDBOX providers' });
    }

    const payload = {
      paymentId: payment.id,
      externalRef: `SBX-${Date.now()}`,
      status: 'SUCCEEDED',
      amount: Number(payment.amountGross),
      currency: payment.currency,
      mode: 'SANDBOX_SERVER_RECONCILIATION',
    };
    const serialized = JSON.stringify(payload);
    const sig = signWebhookPayload(serialized, WEBHOOK_SECRET);
    const verified = verifyWebhookSignature(serialized, sig, WEBHOOK_SECRET);

    const updated = await confirmPaymentServerSide({
      paymentId: payment.id,
      externalRef: payload.externalRef,
      signatureVerified: verified,
      rawPayload: payload,
      reportedAmount: payload.amount,
      reportedCurrency: payload.currency,
    });

    res.json({ payment: updated });
  } catch (err: any) {
    console.error('Sandbox confirmation error:', err);
    res.status(400).json({ error: err.message || 'Sandbox payment reconciliation failed' });
  }
});

app.post(
  '/api/payments/:id/refund',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN', 'LOCAL_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const paymentId = req.params.id;
      if (!isValidUuid(paymentId)) {
        return res.status(400).json({ error: 'Invalid payment identifier' });
      }

      const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      if (!payment) return res.status(404).json({ error: 'Payment not found' });

      const [country] = await db.select().from(countries).where(eq(countries.id, payment.countryId)).limit(1);
      if (!ctx.roles.includes('SUPER_ADMIN') && (!country || !ctx.adminCountryIso2s.includes(country.iso2))) {
        return res.status(403).json({ error: 'Local admin cannot issue refunds outside assigned country' });
      }

      const refund = await issueRefundServerSide({
        paymentId,
        reason: String(req.body?.reason || 'Administrative refund').slice(0, 400),
        actorUid: ctx.uid,
        actorRole: ctx.activeRole,
      });
      res.json({ refund });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Refund failed' });
    }
  }
);

// ============================================================================
// 6. REVIEWS, MESSAGING, NOTIFICATIONS, DISPUTES
// ============================================================================

app.post('/api/reviews', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const { bookingId, rating, comment } = req.body || {};
    if (!isValidUuid(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking identifier' });
    }
    const numericRating = Math.min(Math.max(Math.round(Number(rating || 5)), 1), 5);

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, String(bookingId))).limit(1);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.clientProfileId !== ctx.profileId && !ctx.roles.includes('SUPER_ADMIN')) {
      return res.status(403).json({ error: 'Only booking owner can leave a review' });
    }
    if (!['COMPLETED', 'AWAITING_CLIENT_VALIDATION'].includes(booking.status)) {
      return res.status(409).json({ error: 'Reviews can only be submitted after intervention execution' });
    }

    const [created] = await db
      .insert(reviews)
      .values({
        bookingId: booking.id,
        professionalId: booking.professionalId,
        authorProfileId: ctx.profileId,
        rating: numericRating,
        comment: String(comment || '').slice(0, 800),
      })
      .returning();

    const proReviews = await db
      .select()
      .from(reviews)
      .where(eq(reviews.professionalId, booking.professionalId));
    const avg = proReviews.reduce((acc, r) => acc + r.rating, 0) / Math.max(proReviews.length, 1);

    await db
      .update(professionals)
      .set({
        ratingAvg: avg.toFixed(2),
        reviewsCount: proReviews.length,
      })
      .where(eq(professionals.id, booking.professionalId));

    res.status(201).json({ review: created });
  } catch (err: any) {
    if (isPgUniqueViolation(err)) {
      return res.status(409).json({ error: 'Review already submitted for this booking' });
    }
    console.error('Review error:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

app.get('/api/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const isSuper = ctx.roles.includes('SUPER_ADMIN');
    const query = db
      .select({
        msg: messages,
        senderName: profiles.fullName,
      })
      .from(messages)
      .innerJoin(profiles, eq(messages.senderProfileId, profiles.id));

    const visible = isSuper
      ? await query.orderBy(messages.createdAt).limit(200)
      : await query
          .where(or(eq(messages.senderProfileId, ctx.profileId), eq(messages.recipientProfileId, ctx.profileId)))
          .orderBy(messages.createdAt)
          .limit(200);

    res.json({
      messages: visible.map((m) => ({ ...m.msg, senderName: m.senderName })),
    });
  } catch (err) {
    console.error('Messages load error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

app.post('/api/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const { missionId, recipientProfileId, content } = req.body || {};
    if (!missionId || !content || !isValidUuid(missionId)) {
      return res.status(400).json({ error: 'Valid missionId and content required' });
    }
    if (recipientProfileId && !isValidUuid(recipientProfileId)) {
      return res.status(400).json({ error: 'Invalid recipient identifier' });
    }

    const [mission] = await db.select().from(missions).where(eq(missions.id, String(missionId))).limit(1);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    const [country] = await db.select().from(countries).where(eq(countries.id, mission.countryId)).limit(1);
    const missionQuotes = await db.select().from(quotes).where(eq(quotes.missionId, mission.id));
    const [myPro] = await db.select().from(professionals).where(eq(professionals.profileId, ctx.profileId)).limit(1);

    const participantProfileIds = new Set<string>([mission.clientProfileId]);
    if (mission.targetProfessionalId) {
      const [targetPro] = await db
        .select()
        .from(professionals)
        .where(eq(professionals.id, mission.targetProfessionalId))
        .limit(1);
      if (targetPro) participantProfileIds.add(targetPro.profileId);
    }
    for (const q of missionQuotes) {
      const [qPro] = await db.select().from(professionals).where(eq(professionals.id, q.professionalId)).limit(1);
      if (qPro) participantProfileIds.add(qPro.profileId);
    }
    if (mission.organizationId) {
      const orgMemList = await db.select().from(orgMembers).where(eq(orgMembers.organizationId, mission.organizationId));
      orgMemList.forEach((om) => participantProfileIds.add(om.profileId));
    }

    const isAdminForCountry =
      ctx.roles.includes('SUPER_ADMIN') ||
      (ctx.roles.includes('LOCAL_ADMIN') && !!country && ctx.adminCountryIso2s.includes(country.iso2));
    const isSenderParticipant =
      participantProfileIds.has(ctx.profileId) ||
      (myPro && mission.status === 'REQUESTED' && myPro.countryId === mission.countryId);

    if (!isSenderParticipant && !isAdminForCountry) {
      return res.status(403).json({ error: 'IDOR protection: you are not a participant of this mission' });
    }

    let recipientId = recipientProfileId ? String(recipientProfileId) : mission.clientProfileId;
    if (recipientId === ctx.profileId && mission.targetProfessionalId) {
      const [pro] = await db
        .select()
        .from(professionals)
        .where(eq(professionals.id, mission.targetProfessionalId))
        .limit(1);
      if (pro) recipientId = pro.profileId;
    }

    if (recipientProfileId && !participantProfileIds.has(recipientId) && !isAdminForCountry) {
      return res.status(403).json({ error: 'Recipient is not a participant of this mission' });
    }

    const [created] = await db
      .insert(messages)
      .values({
        missionId: mission.id,
        senderProfileId: ctx.profileId,
        recipientProfileId: recipientId,
        content: String(content).slice(0, 1500),
      })
      .returning();

    res.status(201).json({ message: created });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const rows = await db.select().from(notifications)
      .where(eq(notifications.profileId, ctx.profileId))
      .orderBy(desc(notifications.createdAt)).limit(50);
    res.json({ notifications: rows });
  } catch (err) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.patch('/api/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const id = String(req.params.id);
    if (!isValidUuid(id)) return res.status(400).json({ error: 'Invalid notification ID' });
    const [updated] = await db.update(notifications).set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.profileId, ctx.profileId)))
      .returning({ id: notifications.id, isRead: notifications.isRead });
    if (!updated) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification: updated });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

app.post('/api/disputes', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const { missionId, reason } = req.body || {};
    if (!isValidUuid(missionId)) {
      return res.status(400).json({ error: 'Invalid mission identifier' });
    }
    const [mission] = await db.select().from(missions).where(eq(missions.id, String(missionId))).limit(1);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    const [booking] = await db.select().from(bookings).where(eq(bookings.missionId, mission.id)).limit(1);
    const [myPro] = await db.select().from(professionals).where(eq(professionals.profileId, ctx.profileId)).limit(1);
    const [country] = await db.select().from(countries).where(eq(countries.id, mission.countryId)).limit(1);

    const isClient = mission.clientProfileId === ctx.profileId;
    const isAssignedPro =
      !!myPro && (mission.targetProfessionalId === myPro.id || booking?.professionalId === myPro.id);
    const isAdminForCountry =
      ctx.roles.includes('SUPER_ADMIN') ||
      (ctx.roles.includes('LOCAL_ADMIN') && !!country && ctx.adminCountryIso2s.includes(country.iso2));

    let isOrgMember = false;
    if (mission.organizationId) {
      const [om] = await db
        .select()
        .from(orgMembers)
        .where(and(eq(orgMembers.organizationId, mission.organizationId), eq(orgMembers.profileId, ctx.profileId)))
        .limit(1);
      isOrgMember = !!om;
    }

    if (!isClient && !isAssignedPro && !isOrgMember && !isAdminForCountry) {
      return res.status(403).json({ error: 'IDOR protection: only mission participants can open a dispute' });
    }

    const [created] = await db
      .insert(disputes)
      .values({
        missionId: mission.id,
        countryId: mission.countryId,
        openedByProfileId: ctx.profileId,
        reason: String(reason || 'Intervention dispute').slice(0, 800),
        status: 'OPEN',
      })
      .returning();

    res.status(201).json({ dispute: created });
  } catch (err) {
    console.error('Create dispute error:', err);
    res.status(500).json({ error: 'Failed to open dispute' });
  }
});

// ============================================================================
// 7. ENTERPRISE B2B WORKSPACE
// ============================================================================

app.get('/api/enterprise/overview', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const isSuperAdmin = ctx.roles.includes('SUPER_ADMIN');
    const memberLinks = isSuperAdmin
      ? []
      : await db
          .select({ organizationId: orgMembers.organizationId })
          .from(orgMembers)
          .where(and(eq(orgMembers.profileId, ctx.profileId), eq(orgMembers.isActive, true)));

    const memberOrgIds = [...new Set(memberLinks.map((m) => m.organizationId))];
    const orgs = isSuperAdmin
      ? await db.select().from(organizations)
      : memberOrgIds.length
        ? await db.select().from(organizations).where(
            or(eq(organizations.ownerProfileId, ctx.profileId), inArray(organizations.id, memberOrgIds))
          )
        : await db.select().from(organizations).where(eq(organizations.ownerProfileId, ctx.profileId));

    const requestedOrgId = typeof req.query.organizationId === 'string' ? req.query.organizationId : '';
    const targetOrg = requestedOrgId
      ? orgs.find((org) => org.id === requestedOrgId) || null
      : orgs[0] || null;

    if (requestedOrgId && !targetOrg) {
      return res.status(404).json({ error: 'Organization not found or access denied' });
    }
    if (!targetOrg) {
      return res.json({ organization: null, organizations: orgs, members: [], interventions: [], country: null });
    }

    const [orgCountry] = await db
      .select()
      .from(countries)
      .where(eq(countries.id, targetOrg.countryId))
      .limit(1);

    const members = await db
      .select({
        member: orgMembers,
        profile: profiles,
      })
      .from(orgMembers)
      .innerJoin(profiles, eq(orgMembers.profileId, profiles.id))
      .where(eq(orgMembers.organizationId, targetOrg.id));

    const interventions = await db
      .select({
        mission: missions,
        category: serviceCategories,
      })
      .from(missions)
      .innerJoin(serviceCategories, eq(missions.categoryId, serviceCategories.id))
      .where(eq(missions.organizationId, targetOrg.id))
      .orderBy(desc(missions.createdAt));

    res.json({
      organization: targetOrg,
      organizations: orgs,
      country: orgCountry || null,
      members: members.map((m) => ({
        ...m.member,
        fullName: m.profile.fullName,
        email: m.profile.email,
      })),
      interventions: interventions.map((i) => ({ ...i.mission, category: i.category })),
    });
  } catch (err) {
    console.error('Enterprise overview error:', err);
    res.status(500).json({ error: 'Failed to load enterprise workspace' });
  }
});

app.post('/api/enterprise/organizations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const { name, sector, registrationNumber, countryIso2 } = req.body || {};
    if (!name || !sector) return res.status(400).json({ error: 'Organization name and sector required' });

    const [country] = await db
      .select()
      .from(countries)
      .where(eq(countries.iso2, String(countryIso2 || ctx.countryIso2).toUpperCase()))
      .limit(1);
    if (!country) return res.status(400).json({ error: 'Invalid country' });

    const org = await db.transaction(async (tx) => {
      const [createdOrg] = await tx
        .insert(organizations)
        .values({
          countryId: country.id,
          name: String(name).slice(0, 120),
          sector: String(sector).slice(0, 120),
          registrationNumber: registrationNumber ? String(registrationNumber).slice(0, 80) : null,
          billingCurrency: country.defaultCurrency,
          ownerProfileId: ctx.profileId,
        })
        .returning();

      await tx.insert(orgMembers).values({
        organizationId: createdOrg.id,
        profileId: ctx.profileId,
        memberRole: 'OWNER',
        siteLocation: country.capital,
      });

      return createdOrg;
    });

    await grantUserRoleSafely({
      profileId: ctx.profileId,
      role: 'ENTERPRISE_ADMIN',
      countryIso2: null,
      grantedBy: 'ORG_CREATE',
    });

    res.status(201).json({ organization: org });
  } catch (err) {
    console.error('Create organization error:', err);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

app.post('/api/enterprise/members', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const { organizationId, email, memberRole, siteLocation } = req.body || {};
    if (!isValidUuid(organizationId) || !email) {
      return res.status(400).json({ error: 'Valid organizationId and email are required' });
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const [actingMember] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.organizationId, org.id), eq(orgMembers.profileId, ctx.profileId)))
      .limit(1);

    const canManageOrg =
      ctx.roles.includes('SUPER_ADMIN') ||
      org.ownerProfileId === ctx.profileId ||
      (actingMember && ['OWNER', 'MANAGER'].includes(actingMember.memberRole));

    if (!canManageOrg) {
      return res.status(403).json({ error: 'IDOR protection: only organization managers can add members' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const [targetProfile] = await db.select().from(profiles).where(eq(profiles.email, normalizedEmail)).limit(1);
    if (!targetProfile) {
      return res.status(404).json({ error: 'No registered KAZI AFRICA user found with this email' });
    }

    const allowedRole = ['MANAGER', 'TECHNICIAN', 'DISPATCHER'].includes(String(memberRole))
      ? String(memberRole)
      : 'TECHNICIAN';

    const [existingMember] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.organizationId, org.id), eq(orgMembers.profileId, targetProfile.id)))
      .limit(1);

    if (existingMember) {
      return res.status(409).json({ error: 'User is already a member of this organization' });
    }

    const [created] = await db
      .insert(orgMembers)
      .values({
        organizationId: org.id,
        profileId: targetProfile.id,
        memberRole: allowedRole,
        siteLocation: siteLocation ? String(siteLocation).slice(0, 120) : 'Siège',
      })
      .returning();

    res.status(201).json({
      member: {
        ...created,
        fullName: targetProfile.fullName,
        email: targetProfile.email,
      },
    });
  } catch (err: any) {
    if (isPgUniqueViolation(err)) {
      return res.status(409).json({ error: 'User is already a member of this organization' });
    }
    console.error('Add enterprise member error:', err);
    res.status(500).json({ error: 'Failed to add organization member' });
  }
});

app.post('/api/enterprise/interventions/:id/assign', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const missionId = req.params.id;
    const { professionalId } = req.body || {};
    if (!isValidUuid(missionId) || !isValidUuid(professionalId)) {
      return res.status(400).json({ error: 'Valid missionId and professionalId required' });
    }

    const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
    if (!mission || !mission.organizationId) {
      return res.status(404).json({ error: 'Enterprise intervention not found' });
    }

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, mission.organizationId))
      .limit(1);
    const [actingMember] = org
      ? await db
          .select()
          .from(orgMembers)
          .where(and(eq(orgMembers.organizationId, org.id), eq(orgMembers.profileId, ctx.profileId)))
          .limit(1)
      : [];

    if (
      !ctx.roles.includes('SUPER_ADMIN') &&
      org?.ownerProfileId !== ctx.profileId &&
      (!actingMember || !['OWNER', 'MANAGER', 'DISPATCHER'].includes(actingMember.memberRole))
    ) {
      return res.status(403).json({ error: 'Access denied for enterprise intervention assignment' });
    }

    const [pro] = await db.select().from(professionals).where(eq(professionals.id, professionalId)).limit(1);
    if (!pro) return res.status(404).json({ error: 'Professional not found' });
    if (pro.countryId !== mission.countryId) {
      return res.status(400).json({ error: 'Assigned professional must operate in the intervention country' });
    }

    const [updated] = await db
      .update(missions)
      .set({ targetProfessionalId: pro.id, updatedAt: new Date() })
      .where(eq(missions.id, mission.id))
      .returning();

    res.json({ mission: updated });
  } catch (err) {
    console.error('Enterprise intervention assign error:', err);
    res.status(500).json({ error: 'Failed to assign technician' });
  }
});

// ============================================================================
// 8. KAZI SKILLS (COURSES, ENROLLMENTS, EVALUATIONS, PASSPORT)
// ============================================================================

app.get('/api/skills/courses', async (req, res) => {
  try {
    const category = req.query.category ? String(req.query.category) : null;
    const rows = await db.select().from(trainingCourses).orderBy(desc(trainingCourses.enrolledCount));
    const filtered = category && category !== 'all' ? rows.filter((c) => c.categorySlug === category) : rows;
    res.json({ courses: filtered });
  } catch (err) {
    console.error('Courses fetch error:', err);
    res.status(500).json({ error: 'Failed to load training courses' });
  }
});

app.post(
  '/api/skills/courses',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN', 'TRAINING_PARTNER']),
  async (req: AuthRequest, res) => {
    try {
      const {
        categorySlug,
        partnerOrgName,
        titleFr,
        titleEn,
        titlePt,
        titleAr,
        descriptionFr,
        descriptionPt,
        durationHours,
        level,
        deliveryMode,
        priceEur,
        credentialType,
      } = req.body || {};

      if (!titleFr || !partnerOrgName) {
        return res.status(400).json({ error: 'titleFr and partnerOrgName are required' });
      }

      const [course] = await db
        .insert(trainingCourses)
        .values({
          categorySlug: String(categorySlug || 'electricity'),
          partnerOrgName: String(partnerOrgName),
          titleFr: String(titleFr),
          titleEn: String(titleEn || titleFr),
          titlePt: String(titlePt || titleEn || titleFr),
          titleAr: String(titleAr || titleFr),
          descriptionFr: String(descriptionFr || titleFr),
          descriptionEn: String(descriptionFr || titleEn || titleFr),
          descriptionPt: String(descriptionPt || descriptionFr || titlePt || titleFr),
          descriptionAr: String(descriptionFr || titleFr),
          durationHours: Number(durationHours || 4),
          level: String(level || 'BEGINNER'),
          deliveryMode: String(deliveryMode || 'ONLINE'),
          priceEur: Number(priceEur || 25).toFixed(2),
          thumbnailUrl: '/src/assets/images/course_solar_installation_1794936769118.jpg',
          status: 'PUBLISHED',
          credentialType: String(credentialType || 'PARTNER_ATTESTATION'),
        })
        .returning();

      res.status(201).json({ course });
    } catch (err) {
      console.error('Create course error:', err);
      res.status(500).json({ error: 'Failed to create training course' });
    }
  }
);

app.get('/api/skills/passport', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx;
    if (!ctx) {
      return res.json({
        authenticated: false,
        passport: null,
        enrollments: [],
        evaluations: [],
        certifications: [],
      });
    }

    const requestedProfileId =
      req.query.profileId && ctx.roles.includes('SUPER_ADMIN') && isValidUuid(req.query.profileId)
        ? String(req.query.profileId)
        : ctx.profileId;

    const [passport] = await db
      .select()
      .from(skillPassports)
      .where(eq(skillPassports.profileId, requestedProfileId))
      .limit(1);

    const myEnrollments = await db
      .select({
        enrollment: enrollments,
        course: trainingCourses,
      })
      .from(enrollments)
      .innerJoin(trainingCourses, eq(enrollments.courseId, trainingCourses.id))
      .where(eq(enrollments.profileId, requestedProfileId));

    const myEvaluations = await db
      .select()
      .from(evaluations)
      .where(eq(evaluations.profileId, requestedProfileId));

    const myCerts = await db
      .select()
      .from(certifications)
      .where(eq(certifications.profileId, requestedProfileId));

    res.json({
      authenticated: true,
      passport: passport || {
        tradeTitle: 'Professionnel KAZI',
        completionPct: 0,
        practicalStatus: 'IN_PROGRESS',
        theoreticalStatus: 'IN_PROGRESS',
        kaziCertStatus: 'IN_PROGRESS',
      },
      enrollments: myEnrollments.map((e) => ({ ...e.enrollment, course: e.course })),
      evaluations: myEvaluations,
      certifications: myCerts,
    });
  } catch (err) {
    console.error('Passport error:', err);
    res.status(500).json({ error: 'Failed to load skill passport' });
  }
});

app.post('/api/skills/enroll', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const { courseId } = req.body || {};
    if (!isValidUuid(courseId)) {
      return res.status(400).json({ error: 'Invalid course identifier' });
    }

    const result = await db.transaction(async (tx) => {
      const [course] = await tx
        .select()
        .from(trainingCourses)
        .where(eq(trainingCourses.id, String(courseId)))
        .limit(1);
      if (!course) return { status: 404 as const, body: { error: 'Course not found' } };

      const [existingEnrollment] = await tx
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.courseId, course.id), eq(enrollments.profileId, ctx.profileId)))
        .limit(1);

      if (existingEnrollment) {
        return { status: 200 as const, body: { enrollment: existingEnrollment, alreadyEnrolled: true } };
      }

      const [enrolled] = await tx
        .insert(enrollments)
        .values({
          courseId: course.id,
          profileId: ctx.profileId,
          progressPct: 10,
          status: 'ENROLLED',
        })
        .onConflictDoNothing()
        .returning();

      if (!enrolled) {
        const [concurrentExisting] = await tx
          .select()
          .from(enrollments)
          .where(and(eq(enrollments.courseId, course.id), eq(enrollments.profileId, ctx.profileId)))
          .limit(1);
        return { status: 200 as const, body: { enrollment: concurrentExisting, alreadyEnrolled: true } };
      }

      await tx
        .update(trainingCourses)
        .set({ enrolledCount: sql`${trainingCourses.enrolledCount} + 1` })
        .where(eq(trainingCourses.id, course.id));

      await tx
        .insert(skillPassports)
        .values({
          profileId: ctx.profileId,
          tradeTitle: course.titleFr,
          completionPct: 35,
          practicalStatus: 'IN_PROGRESS',
          theoreticalStatus: 'IN_PROGRESS',
          kaziCertStatus: 'IN_PROGRESS',
        })
        .onConflictDoNothing();

      return { status: 201 as const, body: { enrollment: enrolled } };
    });

    return res.status(result.status).json(result.body);
  } catch (err: any) {
    if (isPgUniqueViolation(err)) {
      const ctx = req.authCtx!;
      const [existing] = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.courseId, String(req.body?.courseId)), eq(enrollments.profileId, ctx.profileId)))
        .limit(1);
      return res.status(200).json({ enrollment: existing, alreadyEnrolled: true });
    }
    console.error('Enrollment error:', err);
    res.status(500).json({ error: 'Failed to enroll in course' });
  }
});

app.post('/api/skills/evaluate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ctx = req.authCtx!;
    const { courseId, evaluationType, scorePct } = req.body || {};
    if (!isValidUuid(courseId)) {
      return res.status(400).json({ error: 'Invalid course identifier' });
    }

    const [course] = await db
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, String(courseId)))
      .limit(1);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.courseId, course.id), eq(enrollments.profileId, ctx.profileId)))
      .limit(1);
    if (!enrollment) {
      return res.status(403).json({ error: 'Must be enrolled in this course before taking an evaluation' });
    }

    const parsedScore = Number(scorePct ?? 85);
    if (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 100) {
      return res.status(400).json({ error: 'Score must be between 0 and 100' });
    }
    const score = Math.round(parsedScore);
    const passed = score >= 70;
    const normalizedType = evaluationType === 'PRACTICAL' ? 'PRACTICAL' : 'THEORETICAL';

    const [evalRow] = await db
      .insert(evaluations)
      .values({
        courseId: course.id,
        profileId: ctx.profileId,
        evaluationType: normalizedType,
        scorePct: score,
        status: passed ? 'PASSED' : 'FAILED',
      })
      .returning();

    const allUserEvals = await db
      .select()
      .from(evaluations)
      .where(eq(evaluations.profileId, ctx.profileId));

    const hasTheoryPassed = allUserEvals.some(
      (e) => e.evaluationType === 'THEORETICAL' && e.status === 'PASSED'
    );
    const hasPracticalPassed = allUserEvals.some(
      (e) => e.evaluationType === 'PRACTICAL' && e.status === 'PASSED'
    );
    const bothPassed = hasTheoryPassed && hasPracticalPassed;
    const completionPct = bothPassed ? 100 : hasTheoryPassed || hasPracticalPassed ? 65 : 35;

    await db
      .insert(skillPassports)
      .values({
        profileId: ctx.profileId,
        tradeTitle: course.titleFr,
        completionPct,
        practicalStatus: hasPracticalPassed ? 'PASSED' : 'IN_PROGRESS',
        theoreticalStatus: hasTheoryPassed ? 'PASSED' : 'IN_PROGRESS',
        kaziCertStatus: bothPassed ? 'PASSED' : 'IN_PROGRESS',
      })
      .onConflictDoUpdate({
        target: skillPassports.profileId,
        set: {
          completionPct,
          practicalStatus: hasPracticalPassed ? 'PASSED' : 'IN_PROGRESS',
          theoreticalStatus: hasTheoryPassed ? 'PASSED' : 'IN_PROGRESS',
          kaziCertStatus: bothPassed ? 'PASSED' : 'IN_PROGRESS',
          updatedAt: new Date(),
        },
      });

    await db
      .update(enrollments)
      .set({
        progressPct: passed ? Math.max(enrollment.progressPct, bothPassed ? 100 : 65) : enrollment.progressPct,
        status: bothPassed ? 'COMPLETED' : 'IN_PROGRESS',
      })
      .where(eq(enrollments.id, enrollment.id));

    res.status(201).json({ evaluation: evalRow });
  } catch (err) {
    console.error('Evaluation error:', err);
    res.status(500).json({ error: 'Failed to submit evaluation' });
  }
});

// ============================================================================
// 9. CENTRAL & LOCAL ADMINISTRATION
// ============================================================================

app.get(
  '/api/admin/overview',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN', 'LOCAL_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const countryFilter = req.query.countryIso2 ? String(req.query.countryIso2).toUpperCase() : 'ALL';
      const isSuper = ctx.roles.includes('SUPER_ADMIN');

      if (!isSuper && countryFilter !== 'ALL' && !ctx.adminCountryIso2s.includes(countryFilter)) {
        return res.status(403).json({ error: 'Local admin access restricted to assigned country' });
      }

      const allCountries = await db.select().from(countries);
      const countryIdToIso = new Map(allCountries.map((c) => [c.id, c.iso2]));
      const allowedIso2Set: Set<string> | null =
        countryFilter !== 'ALL'
          ? new Set([countryFilter])
          : isSuper
          ? null
          : new Set(ctx.adminCountryIso2s);

      const inScopeIso = (iso2?: string | null) => {
        if (!allowedIso2Set) return true;
        return !!iso2 && allowedIso2Set.has(iso2.toUpperCase());
      };

      const allProfiles = await db.select().from(profiles);
      const scopedProfiles = allProfiles.filter((p) => inScopeIso(p.countryIso2));
      const profileNameMap = new Map(allProfiles.map((p) => [p.id, p.fullName]));

      const allPros = await db.select().from(professionals);
      const scopedPros = allPros.filter((pr) => inScopeIso(countryIdToIso.get(pr.countryId)));

      const allMissions = await db.select().from(missions);
      const scopedMissions = allMissions.filter((m) => inScopeIso(countryIdToIso.get(m.countryId)));

      const allBookings = await db.select().from(bookings);
      const bookingNumberMap = new Map(allBookings.map((b) => [b.id, b.bookingNumber]));

      const allPayments = await db.select().from(payments).orderBy(desc(payments.createdAt));
      const scopedPayments = allPayments.filter((p) => inScopeIso(countryIdToIso.get(p.countryId)));

      const allVerifications = await db
        .select({
          verification: verifications,
          pro: professionals,
          profile: profiles,
          country: countries,
        })
        .from(verifications)
        .innerJoin(professionals, eq(verifications.professionalId, professionals.id))
        .innerJoin(profiles, eq(professionals.profileId, profiles.id))
        .innerJoin(countries, eq(professionals.countryId, countries.id))
        .orderBy(desc(verifications.submittedAt));

      const scopedVerifications = allVerifications.filter((v) => inScopeIso(v.country.iso2));

      const allDisputes = await db
        .select({
          dispute: disputes,
          country: countries,
          mission: missions,
        })
        .from(disputes)
        .innerJoin(countries, eq(disputes.countryId, countries.id))
        .innerJoin(missions, eq(disputes.missionId, missions.id))
        .orderBy(desc(disputes.createdAt));

      const scopedDisputes = allDisputes.filter((d) => inScopeIso(d.country.iso2));

      const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(50);
      const scopedLogs = logs.filter((l) => (isSuper && countryFilter === 'ALL' ? true : inScopeIso(l.countryIso2)));

      const activePayments = scopedPayments.filter((p) => p.status !== 'REFUNDED' && p.status !== 'FAILED');
      const totalRevenue = activePayments.reduce((sum, p) => sum + Number(p.amountGross), 0);
      const totalCommissions = activePayments.reduce((sum, p) => sum + Number(p.commissionAmount), 0);

      // Compute 6-month activity series directly from DB timestamps
      const now = new Date();
      const monthlySeries = Array.from({ length: 6 }, (_, idx) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
        const year = d.getFullYear();
        const month = d.getMonth();
        const label = d.toLocaleString('en-US', { month: 'short' });
        const missionsCount = scopedMissions.filter((m) => {
          const dt = new Date(m.createdAt);
          return dt.getFullYear() === year && dt.getMonth() === month;
        }).length;
        const volumeEur = activePayments
          .filter((p) => {
            const dt = new Date(p.createdAt);
            return dt.getFullYear() === year && dt.getMonth() === month;
          })
          .reduce((acc, p) => acc + Number(p.amountGross), 0);
        return { label, missionsCount, volumeEur };
      });

      res.json({
        scope: allowedIso2Set ? Array.from(allowedIso2Set) : 'ALL',
        kpis: {
          usersCount: scopedProfiles.length,
          professionalsCount: scopedPros.length,
          missionsCount: scopedMissions.length,
          revenueEur: totalRevenue,
          commissionsEur: totalCommissions,
          pendingVerifications: scopedVerifications.filter((v) => v.verification.status === 'PENDING').length,
          openDisputes: scopedDisputes.filter((d) => d.dispute.status === 'OPEN').length,
        },
        monthlySeries,
        payments: scopedPayments.map((p) => ({
          ...p,
          countryIso2: countryIdToIso.get(p.countryId) || 'CI',
          bookingNumber: bookingNumberMap.get(p.bookingId) || '-',
          payerName: profileNameMap.get(p.payerProfileId) || '-',
        })),
        verifications: scopedVerifications.map((v) => ({
          ...v.verification,
          professionalName: v.profile.fullName,
          countryIso2: v.country.iso2,
        })),
        disputes: scopedDisputes.map((d) => ({
          ...d.dispute,
          countryIso2: d.country.iso2,
          missionRef: d.mission.referenceCode,
        })),
        auditLogs: scopedLogs,
      });
    } catch (err) {
      console.error('Admin overview error:', err);
      res.status(500).json({ error: 'Failed to load admin overview' });
    }
  }
);

app.get(
  '/api/admin/users',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN', 'LOCAL_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const isSuper = ctx.roles.includes('SUPER_ADMIN');
      const allProfiles = await db.select().from(profiles).orderBy(desc(profiles.createdAt));
      const allRoles = await db.select().from(userRoles);
      const allCountryAdmins = await db
        .select({
          profileId: countryAdmins.profileId,
          iso2: countries.iso2,
        })
        .from(countryAdmins)
        .innerJoin(countries, eq(countryAdmins.countryId, countries.id));

      const scoped = isSuper
        ? allProfiles
        : allProfiles.filter((p) => ctx.adminCountryIso2s.includes(p.countryIso2));

      res.json({
        users: scoped.map((p) => ({
          id: p.id,
          uid: p.uid,
          email: p.email,
          fullName: p.fullName,
          countryIso2: p.countryIso2,
          cityName: p.cityName,
          activeRole: p.activeRole,
          isSuspended: p.isSuspended,
          createdAt: p.createdAt,
          roles: Array.from(new Set(allRoles.filter((r) => r.profileId === p.id).map((r) => r.role))),
          adminCountries: Array.from(
            new Set([
              ...allCountryAdmins.filter((ca) => ca.profileId === p.id).map((ca) => ca.iso2),
              ...allRoles
                .filter((r) => r.profileId === p.id && r.role === 'LOCAL_ADMIN' && r.countryIso2)
                .map((r) => String(r.countryIso2)),
            ])
          ),
        })),
      });
    } catch (err) {
      console.error('Admin users fetch error:', err);
      res.status(500).json({ error: 'Failed to load users directory' });
    }
  }
);

app.post(
  '/api/admin/users/:id/roles',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const targetProfileId = req.params.id;
      if (!isValidUuid(targetProfileId)) {
        return res.status(400).json({ error: 'Invalid user identifier' });
      }
      const { role, action, countryIso2 } = req.body || {};
      const validRoles: AppRole[] = [
        'CLIENT',
        'PROFESSIONAL',
        'ENTERPRISE_ADMIN',
        'TRAINING_PARTNER',
        'LOCAL_ADMIN',
        'SUPER_ADMIN',
      ];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      if (!['GRANT', 'REVOKE'].includes(String(action))) {
        return res.status(400).json({ error: 'Action must be GRANT or REVOKE' });
      }

      const [targetUser] = await db.select().from(profiles).where(eq(profiles.id, targetProfileId)).limit(1);
      if (!targetUser) return res.status(404).json({ error: 'User not found' });

      if (targetUser.id === ctx.profileId && role === 'SUPER_ADMIN' && action === 'REVOKE') {
        return res.status(400).json({ error: 'Cannot revoke your own SUPER_ADMIN privilege' });
      }

      const normalizedIso = countryIso2 ? String(countryIso2).toUpperCase() : targetUser.countryIso2;
      if (role === 'LOCAL_ADMIN') {
        const [country] = await db.select().from(countries).where(eq(countries.iso2, normalizedIso)).limit(1);
        if (!country) return res.status(400).json({ error: 'Valid countryIso2 required for LOCAL_ADMIN' });

        if (action === 'GRANT') {
          await db
            .insert(userRoles)
            .values({
              profileId: targetUser.id,
              role: 'LOCAL_ADMIN',
              countryIso2: normalizedIso,
              grantedBy: ctx.uid,
            })
            .onConflictDoNothing();
          const [existingAdmin] = await db
            .select()
            .from(countryAdmins)
            .where(and(eq(countryAdmins.countryId, country.id), eq(countryAdmins.profileId, targetUser.id)))
            .limit(1);
          if (!existingAdmin) {
            await db.insert(countryAdmins).values({ countryId: country.id, profileId: targetUser.id });
          }
          await db
            .update(countryDeployments)
            .set({ localLeadAssigned: true, updatedAt: new Date() })
            .where(eq(countryDeployments.countryId, country.id));
        } else {
          await db
            .delete(userRoles)
            .where(
              and(
                eq(userRoles.profileId, targetUser.id),
                eq(userRoles.role, 'LOCAL_ADMIN'),
                eq(userRoles.countryIso2, normalizedIso)
              )
            );
          await db
            .delete(countryAdmins)
            .where(and(eq(countryAdmins.countryId, country.id), eq(countryAdmins.profileId, targetUser.id)));
        }
      } else if (action === 'GRANT') {
        await grantUserRoleSafely({
          profileId: targetUser.id,
          role,
          countryIso2: null,
          grantedBy: ctx.uid,
        });
      } else {
        await db
          .delete(userRoles)
          .where(and(eq(userRoles.profileId, targetUser.id), eq(userRoles.role, role)));
      }

      await db.insert(auditLogs).values({
        actorProfileId: ctx.profileId,
        actorUid: ctx.uid,
        actorRole: 'SUPER_ADMIN',
        countryIso2: role === 'LOCAL_ADMIN' ? normalizedIso : targetUser.countryIso2,
        action: `USER_ROLE_${action}`,
        entityType: 'profile',
        entityId: targetUser.id,
        details: { role, countryIso2: role === 'LOCAL_ADMIN' ? normalizedIso : null },
      });

      res.json({ success: true });
    } catch (err) {
      console.error('Role management error:', err);
      res.status(500).json({ error: 'Failed to update user role' });
    }
  }
);

app.patch(
  '/api/admin/users/:id/suspend',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN', 'LOCAL_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const targetProfileId = req.params.id;
      if (!isValidUuid(targetProfileId)) {
        return res.status(400).json({ error: 'Invalid user identifier' });
      }
      if (targetProfileId === ctx.profileId) {
        return res.status(400).json({ error: 'Cannot suspend your own account' });
      }

      const [targetUser] = await db.select().from(profiles).where(eq(profiles.id, targetProfileId)).limit(1);
      if (!targetUser) return res.status(404).json({ error: 'User not found' });

      if (!ctx.roles.includes('SUPER_ADMIN') && !ctx.adminCountryIso2s.includes(targetUser.countryIso2)) {
        return res.status(403).json({ error: 'Local admin cannot suspend users in another country' });
      }

      const targetRoles = await db.select().from(userRoles).where(eq(userRoles.profileId, targetUser.id));
      if (targetRoles.some((r) => r.role === 'SUPER_ADMIN')) {
        return res.status(403).json({ error: 'Cannot suspend a SUPER_ADMIN account' });
      }

      const nextSuspended = Boolean(req.body?.isSuspended);
      const [updated] = await db
        .update(profiles)
        .set({ isSuspended: nextSuspended, updatedAt: new Date() })
        .where(eq(profiles.id, targetUser.id))
        .returning();

      await db.insert(auditLogs).values({
        actorProfileId: ctx.profileId,
        actorUid: ctx.uid,
        actorRole: ctx.activeRole,
        countryIso2: targetUser.countryIso2,
        action: nextSuspended ? 'USER_SUSPENDED' : 'USER_REINSTATED',
        entityType: 'profile',
        entityId: targetUser.id,
        details: { email: targetUser.email },
      });

      res.json({ user: updated });
    } catch (err) {
      console.error('User suspension error:', err);
      res.status(500).json({ error: 'Failed to update user suspension status' });
    }
  }
);

app.post(
  '/api/admin/verifications/:id/review',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN', 'LOCAL_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const verificationId = req.params.id;
      if (!isValidUuid(verificationId)) {
        return res.status(400).json({ error: 'Invalid verification identifier' });
      }
      const { decision, reviewNote } = req.body || {};

      if (!['APPROVED', 'REJECTED'].includes(decision)) {
        return res.status(400).json({ error: 'Decision must be APPROVED or REJECTED' });
      }

      const rows = await db
        .select({
          verification: verifications,
          pro: professionals,
          country: countries,
        })
        .from(verifications)
        .innerJoin(professionals, eq(verifications.professionalId, professionals.id))
        .innerJoin(countries, eq(professionals.countryId, countries.id))
        .where(eq(verifications.id, verificationId))
        .limit(1);

      const target = rows[0];
      if (!target) return res.status(404).json({ error: 'Verification record not found' });

      if (!ctx.roles.includes('SUPER_ADMIN') && !ctx.adminCountryIso2s.includes(target.country.iso2)) {
        return res.status(403).json({ error: 'Local admin cannot review outside assigned country' });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(verifications)
          .set({
            status: decision,
            reviewerUid: ctx.uid,
            reviewNote: reviewNote ? String(reviewNote).slice(0, 500) : null,
            reviewedAt: new Date(),
          })
          .where(eq(verifications.id, verificationId));

        await tx
          .update(professionals)
          .set({ isVerified: decision === 'APPROVED' })
          .where(eq(professionals.id, target.pro.id));

        await tx.insert(auditLogs).values({
          actorProfileId: ctx.profileId,
          actorUid: ctx.uid,
          actorRole: ctx.activeRole,
          countryIso2: target.country.iso2,
          action: `VERIFICATION_${decision}`,
          entityType: 'verification',
          entityId: verificationId,
          details: { professionalId: target.pro.id },
        });
      });

      res.json({ success: true, decision });
    } catch (err) {
      console.error('Verification review error:', err);
      res.status(500).json({ error: 'Failed to process verification review' });
    }
  }
);

app.post(
  '/api/admin/disputes/:id/resolve',
  requireAuth,
  requireAnyRole(['SUPER_ADMIN', 'LOCAL_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const disputeId = req.params.id;
      if (!isValidUuid(disputeId)) {
        return res.status(400).json({ error: 'Invalid dispute identifier' });
      }
      const { status, resolutionNote } = req.body || {};

      const rows = await db
        .select({
          dispute: disputes,
          country: countries,
        })
        .from(disputes)
        .innerJoin(countries, eq(disputes.countryId, countries.id))
        .where(eq(disputes.id, disputeId))
        .limit(1);

      const target = rows[0];
      if (!target) return res.status(404).json({ error: 'Dispute not found' });

      if (!ctx.roles.includes('SUPER_ADMIN') && !ctx.adminCountryIso2s.includes(target.country.iso2)) {
        return res.status(403).json({ error: 'Local admin cannot resolve disputes outside assigned country' });
      }

      const [updated] = await db
        .update(disputes)
        .set({
          status: status === 'RESOLVED_REFUND' ? 'RESOLVED_REFUND' : 'RESOLVED_RELEASE',
          resolutionNote: String(resolutionNote || 'Resolved by moderation team').slice(0, 800),
          resolvedByUid: ctx.uid,
          resolvedAt: new Date(),
        })
        .where(eq(disputes.id, disputeId))
        .returning();

      await db.insert(auditLogs).values({
        actorProfileId: ctx.profileId,
        actorUid: ctx.uid,
        actorRole: ctx.activeRole,
        countryIso2: target.country.iso2,
        action: 'DISPUTE_RESOLVED',
        entityType: 'dispute',
        entityId: disputeId,
        details: { status: updated.status },
      });

      res.json({ dispute: updated });
    } catch (err) {
      console.error('Dispute resolve error:', err);
      res.status(500).json({ error: 'Failed to resolve dispute' });
    }
  }
);

// ============================================================================
// 10. GEMINI AI MODULE (SERVER-SIDE ONLY)
// ============================================================================

app.post('/api/ai/match', aiRateLimit, async (req, res) => {
  try {
    const { query, countryIso2, lang } = req.body || {};
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'query is required' });
    }

    const allPros = await db
      .select({ pro: professionals, profile: profiles, country: countries })
      .from(professionals)
      .innerJoin(profiles, eq(professionals.profileId, profiles.id))
      .innerJoin(countries, eq(professionals.countryId, countries.id));

    const scoped = countryIso2
      ? allPros.filter((p) => p.country.iso2 === String(countryIso2).toUpperCase())
      : allPros;

    const summary = (scoped.length > 0 ? scoped : allPros).slice(0, 12).map((p) => ({
      id: p.pro.id,
      name: p.profile.fullName,
      category: p.pro.primaryCategorySlug,
      city: p.pro.city,
      rating: p.pro.ratingAvg,
      verified: p.pro.isVerified,
      skills: [p.pro.headlineFr],
    }));

    const result = await aiMatchProfessionals({
      query: String(query),
      countryName: String(countryIso2 || 'Afrique'),
      lang: String(lang || 'fr'),
      professionalsSummary: summary,
    });
    res.json(result);
  } catch (err: any) {
    console.error('AI match error:', err);
    res.status(502).json({ error: 'AI matching service temporarily unavailable' });
  }
});

app.post('/api/ai/quote-assist', aiRateLimit, requireAuth, async (req, res) => {
  try {
    const { missionTitle, missionDescription, city, currency, lang } = req.body || {};
    const result = await aiDraftQuote({
      missionTitle: String(missionTitle || 'Intervention technique'),
      missionDescription: String(missionDescription || ''),
      city: String(city || 'Abidjan'),
      currency: String(currency || 'XOF'),
      lang: String(lang || 'fr'),
    });
    res.json(result);
  } catch (err: any) {
    console.error('AI quote assist error:', err);
    res.status(502).json({ error: 'AI quote assistant temporarily unavailable' });
  }
});

app.post('/api/ai/profile-assist', aiRateLimit, requireAuth, async (req, res) => {
  try {
    const { trade, yearsExperience, rawBio, targetLang } = req.body || {};
    const result = await aiAssistProfileAndTranslate({
      trade: String(trade || 'Électricien'),
      yearsExperience: Number(yearsExperience || 3),
      rawBio: String(rawBio || ''),
      targetLang: targetLang ? String(targetLang) : 'fr',
    });
    res.json(result);
  } catch (err: any) {
    console.error('AI profile assist error:', err);
    res.status(502).json({ error: 'AI profile assistant temporarily unavailable' });
  }
});

app.post(
  '/api/ai/analytics',
  aiRateLimit,
  requireAuth,
  requireAnyRole(['SUPER_ADMIN', 'LOCAL_ADMIN']),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authCtx!;
      const { lang, metricsSnapshot } = req.body || {};
      const safeSnapshot =
        ctx.roles.includes('SUPER_ADMIN') && metricsSnapshot
          ? metricsSnapshot
          : { scopeCountries: ctx.adminCountryIso2s };
      const result = await aiAnalyzeTrendsAndRisks({
        lang: String(lang || 'fr'),
        metricsSnapshot: safeSnapshot,
      });
      res.json(result);
    } catch (err: any) {
      console.error('AI analytics error:', err);
      res.status(502).json({ error: 'AI analytics service temporarily unavailable' });
    }
  }
);

// ============================================================================
// GLOBAL API ERROR HANDLER (SANITIZED)
// ============================================================================

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const reqId = (req as AuthRequest).requestId;
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON request body', requestId: reqId });
  }
  if (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId: reqId,
        method: req.method,
        path: req.path,
        message: err.message || 'Unhandled error',
      })
    );
    if (res.headersSent) return next(err);
    return res.status(err.status || 500).json({ error: 'Internal server error', requestId: reqId });
  }
  return next();
});

// ============================================================================
// VITE / STATIC SERVING
// ============================================================================

export async function startServer() {
  const envReport = validateRuntimeEnvironment();
  console.log(
    JSON.stringify({
      level: envReport.ok ? 'info' : 'warn',
      event: 'STARTUP_ENV_VALIDATION',
      mode: envReport.mode,
      ok: envReport.ok,
      missingRequiredInProd: envReport.missingRequiredInProd,
      warnings: envReport.warnings,
    })
  );

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
        ws: {
          server: httpServer,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`KAZI AFRICA server running on http://0.0.0.0:${PORT}`);
  });
}

if (process.env.KAZI_TEST_NO_LISTEN !== '1') {
  startServer();
}
