import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../drizzle/0001_kazi_protect_global.sql');
const provision = read('../drizzle/0002_kazi_protect_provision_countries.sql');
const idempotency = read('../drizzle/0003_kazi_protect_claim_idempotency.sql');
const schema = JSON.parse(read('../src/data/kaziProtectCountryConfig.schema.json'));
const routes = read('../src/server/kaziProtectRoutes.ts');
const drizzle = read('../src/db/schema.ts');

test('country configuration contract requires explicit country and release gates', () => {
  assert.ok(schema.required.includes('countryIso2'));
  assert.ok(schema.required.includes('releaseGates'));
  assert.ok(schema.properties.status.enum.includes('NOT_REVIEWED'));
  assert.ok(schema.properties.status.enum.includes('ACTIVE'));
});

test('global product catalogue is seeded but not globally activated', () => {
  assert.match(migration, /is_globally_available boolean NOT NULL DEFAULT false/);
  assert.match(migration, /status text NOT NULL DEFAULT 'DISABLED'/);
  assert.match(migration, /ON CONFLICT \(product_code\) DO NOTHING/);
  assert.doesNotMatch(migration, /UPDATE kazi_protect_country_products SET status = 'ACTIVE'/);
});

test('country provisioning creates disabled defaults for every canonical country', () => {
  assert.match(provision, /FROM countries c/);
  assert.match(provision, /'NOT_REVIEWED'/);
  assert.match(provision, /'DISABLED'/);
  assert.match(provision, /ON CONFLICT DO NOTHING/);
  assert.match(provision, /provisioning incomplete/);
});

test('claim intake has a unique per-claimant idempotency key', () => {
  assert.match(idempotency, /ALTER TABLE kazi_protect_claims ADD COLUMN IF NOT EXISTS idempotency_key/);
  assert.match(idempotency, /UNIQUE INDEX IF NOT EXISTS kazi_protect_claims_claimant_idempotency_idx/);
  assert.match(routes, /Idempotency-Key/);
  assert.match(routes, /ON CONFLICT \(claimant_profile_id, idempotency_key\) DO NOTHING/);
});

test('insurance approval and activation require country legal approval and partner verification', () => {
  assert.match(routes, /Only central compliance administration can approve a country legal review/);
  assert.match(routes, /verifiedAuthorizedPartner/);
  assert.match(routes, /countryNotActive/);
  assert.match(routes, /status = 'VERIFIED'/);
  assert.match(routes, /regulatory_review_status !== 'APPROVED'/);
});

test('Drizzle schema includes KAZI PROTECT tables and idempotency field', () => {
  for (const table of [
    'kaziProtectCountrySettings', 'kaziProtectProducts', 'kaziProtectCountryProducts',
    'kaziProtectPartners', 'kaziProtectCertificates', 'kaziProtectClaims', 'kaziProtectAuditEvents',
  ]) assert.match(drizzle, new RegExp(`export const ${table} = pgTable`));
  assert.match(drizzle, /idempotencyKey: text\('idempotency_key'\)/);
});

test('insurance claim workflow cannot decide coverage on behalf of insurer', () => {
  assert.match(routes, /INSURER_DECISION_REQUIRED/);
  assert.match(routes, /Insurance coverage decisions must be supplied by the authorized insurer/);
  assert.match(routes, /FOR UPDATE OF cl/);
  assert.match(routes, /CLAIM_STATUS_CHANGED/);
});
