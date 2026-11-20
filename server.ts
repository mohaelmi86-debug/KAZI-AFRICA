import express from 'express';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { createServer as createViteServer } from 'vite';
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
  evaluations,
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
import { registerKaziProtectRoutes } from './src/server/kaziProtectRoutes.ts';
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
    const rows = ctx.roles.includes('SUPER_ADMIN')
      ? await db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(20)
      : await db
          .select()
          .from(notifications)
          .where(eq(notifications.profileId, ctx.profileId))
          .orderBy(desc(notifications.createdAt))
          .limit(20);
    res.json({ notifications: rows });
  } catch (err) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
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
    const allOrgs = await db.select().from(organizations);
    const memberLinks = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.profileId, ctx.profileId));

    const accessibleOrgIds = new Set(memberLinks.map((m) => m.organizationId));
    const orgs = ctx.roles.includes('SUPER_ADMIN')
      ? allOrgs
      : allOrgs.filter((o) => o.ownerProfileId === ctx.profileId || accessibleOrgIds.has(o.id));

    const targetOrg = orgs[0] || null;
    if (!targetOrg) {
      return res.json({ organization: null, members: [], interventions: [], country: null });
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

registerKaziProtectRoutes(app);

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
