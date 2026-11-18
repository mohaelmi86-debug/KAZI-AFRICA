import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { and, eq, isNull } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { profiles, userRoles, countryAdmins, countries } from '../db/schema.ts';

export type AppRole =
  | 'CLIENT'
  | 'PROFESSIONAL'
  | 'ENTERPRISE_ADMIN'
  | 'TRAINING_PARTNER'
  | 'LOCAL_ADMIN'
  | 'SUPER_ADMIN';

export interface AuthContext {
  uid: string;
  email: string;
  profileId: string;
  fullName: string;
  countryIso2: string;
  roles: AppRole[];
  adminCountryIso2s: string[];
  activeRole: AppRole;
  isSuspended: boolean;
}

export interface AuthRequest extends Request {
  firebaseUser?: DecodedIdToken;
  authCtx?: AuthContext;
  requestId?: string;
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const MAX_RATE_LIMIT_ENTRIES = 10_000;

export function __resetRateLimitForTest() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Rate limit reset is only allowed when NODE_ENV=test');
  }
  rateLimitStore.clear();
}

export const rateLimit = (maxRequests = 120, windowMs = 60_000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (rateLimitStore.size > MAX_RATE_LIMIT_ENTRIES) {
      for (const [k, v] of rateLimitStore.entries()) {
        if (v.resetAt < now) rateLimitStore.delete(k);
      }
      if (rateLimitStore.size > MAX_RATE_LIMIT_ENTRIES) {
        rateLimitStore.clear();
      }
    }

    const authReq = req as AuthRequest;
    const actorKey = authReq.authCtx?.uid || req.ip || 'unknown';
    const key = `${actorKey}:${req.baseUrl}${req.path.split('/').slice(0, 3).join('/')}`;
    const existing = rateLimitStore.get(key);

    if (!existing || existing.resetAt < now) {
      const resetAt = now + windowMs;
      rateLimitStore.set(key, { count: 1, resetAt });
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(maxRequests - 1, 0)));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      return next();
    }

    if (existing.count >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(existing.resetAt / 1000)));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'Rate limit exceeded. Please wait before retrying.',
      });
    }

    existing.count += 1;
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(maxRequests - existing.count, 0)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(existing.resetAt / 1000)));
    return next();
  };
};

export async function grantUserRoleSafely(params: {
  profileId: string;
  role: AppRole;
  countryIso2?: string | null;
  grantedBy: string;
}): Promise<void> {
  const normalizedCountry = params.countryIso2 ? params.countryIso2.toUpperCase() : null;
  const existing = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.profileId, params.profileId),
        eq(userRoles.role, params.role),
        normalizedCountry ? eq(userRoles.countryIso2, normalizedCountry) : isNull(userRoles.countryIso2)
      )
    )
    .limit(1);

  if (existing.length > 0) return;

  await db
    .insert(userRoles)
    .values({
      profileId: params.profileId,
      role: params.role,
      countryIso2: normalizedCountry,
      grantedBy: params.grantedBy,
    })
    .onConflictDoNothing();
}

const BOOTSTRAP_SUPER_ADMINS = new Set(['moha.elmi86@gmail.com']);

async function resolveAuthContext(decoded: DecodedIdToken): Promise<AuthContext> {
  const email = (decoded.email || '').toLowerCase();
  const displayName = decoded.name || email.split('@')[0] || 'Utilisateur KAZI';

  const existing = await db
    .select()
    .from(profiles)
    .where(eq(profiles.uid, decoded.uid))
    .limit(1);

  let profile = existing[0];
  if (!profile) {
    const inserted = await db
      .insert(profiles)
      .values({
        uid: decoded.uid,
        email,
        fullName: displayName,
        avatarUrl: decoded.picture || null,
        countryIso2: 'CI',
        cityName: 'Abidjan',
        preferredLang: 'fr',
        activeRole: BOOTSTRAP_SUPER_ADMINS.has(email) ? 'SUPER_ADMIN' : 'CLIENT',
      })
      .onConflictDoUpdate({
        target: profiles.uid,
        set: { email, updatedAt: new Date() },
      })
      .returning();
    profile = inserted[0];
  }

  let roleRows = await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.profileId, profile.id));

  if (roleRows.length === 0) {
    const rolesToGrant: AppRole[] = BOOTSTRAP_SUPER_ADMINS.has(email)
      ? ['CLIENT', 'PROFESSIONAL', 'ENTERPRISE_ADMIN', 'TRAINING_PARTNER', 'LOCAL_ADMIN', 'SUPER_ADMIN']
      : ['CLIENT'];

    for (const r of rolesToGrant) {
      await grantUserRoleSafely({
        profileId: profile.id,
        role: r,
        countryIso2: r === 'LOCAL_ADMIN' ? profile.countryIso2 : null,
        grantedBy: 'SYSTEM_BOOTSTRAP',
      });
    }
    roleRows = await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.profileId, profile.id));
  }

  const roles = Array.from(new Set(roleRows.map((r) => r.role as AppRole)));
  const localAdminRows = await db
    .select({ iso2: countries.iso2 })
    .from(countryAdmins)
    .innerJoin(countries, eq(countryAdmins.countryId, countries.id))
    .where(eq(countryAdmins.profileId, profile.id));

  const adminCountryIso2s = Array.from(
    new Set([
      ...localAdminRows.map((c) => c.iso2),
      ...roleRows.filter((r) => r.role === 'LOCAL_ADMIN' && r.countryIso2).map((r) => r.countryIso2 as string),
    ])
  );

  const activeRole = roles.includes(profile.activeRole as AppRole)
    ? (profile.activeRole as AppRole)
    : roles[0] || 'CLIENT';

  return {
    uid: decoded.uid,
    email,
    profileId: profile.id,
    fullName: profile.fullName,
    countryIso2: profile.countryIso2,
    roles,
    adminCountryIso2s,
    activeRole,
    isSuspended: profile.isSuspended,
  };
}

const CHECK_FIREBASE_REVOKED = process.env.FIREBASE_CHECK_REVOKED === 'true';

let verifyIdTokenFn: (token: string) => Promise<DecodedIdToken> = (token) =>
  adminAuth.verifyIdToken(token, CHECK_FIREBASE_REVOKED);

export function __setVerifyIdTokenForTest(fn: ((token: string) => Promise<DecodedIdToken>) | null) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Test auth override is only allowed when NODE_ENV=test');
  }
  verifyIdTokenFn = fn ?? ((token) => adminAuth.verifyIdToken(token, CHECK_FIREBASE_REVOKED));
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication token missing' });
  }

  try {
    const decoded = await verifyIdTokenFn(token);
    req.firebaseUser = decoded;
    req.authCtx = await resolveAuthContext(decoded);
    if (req.authCtx.isSuspended) {
      return res.status(403).json({ error: 'Account suspended' });
    }
    return next();
  } catch (err: any) {
    const code = String(err?.code || err?.message || '');
    if (code.includes('id-token-revoked') || code.toLowerCase().includes('revoked')) {
      return res.status(401).json({ error: 'Authentication token has been revoked' });
    }
    console.error('Auth verification error:', err?.message || 'Token rejected');
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
};

export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return next();
  try {
    const decoded = await verifyIdTokenFn(token);
    req.firebaseUser = decoded;
    req.authCtx = await resolveAuthContext(decoded);
  } catch {
    // Ignore invalid optional token on public routes
  }
  return next();
};

export const requireAnyRole = (allowed: AppRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authCtx) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const hasRole = req.authCtx.roles.some((r) => allowed.includes(r));
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient role permissions' });
    }
    return next();
  };
};
