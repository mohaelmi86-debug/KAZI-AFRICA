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

test('contractual warranty issuance is gated by client-validated completion and approved country terms', () => {
  const issuance = read('../src/server/kaziProtectIssuanceRoutes.ts');
  const migration = read('../drizzle/0004_kazi_protect_warranty_issuance.sql');
  assert.match(issuance, /bookingStatus !== 'COMPLETED' \|\| !booking\.clientValidatedAt/);
  assert.match(issuance, /issuer_type,\s*coverage_summary/);
  assert.match(issuance, /'CONTRACTUAL_WARRANTY', 'PROFESSIONAL'/);
  assert.match(issuance, /warrantyDurationDays/);
  assert.match(issuance, /warrantyConfigApprovedBy/);
  assert.match(issuance, /createHash\('sha256'\)/);
  assert.match(issuance, /randomBytes\(32\)/);
  assert.match(issuance, /CONTRACTUAL_WARRANTY_ISSUED/);
  assert.match(drizzle, /kazi_protect_certificates_booking_contractual_warranty_uidx/);
  assert.match(drizzle, /\.where\(sql/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS kazi_protect_certificates_booking_contractual_warranty_uidx/);
  assert.match(migration, /WHERE booking_id IS NOT NULL AND protection_kind = 'CONTRACTUAL_WARRANTY'/);
});

test('handover requires before/after evidence and client acceptance before warranty issuance', () => {
  const handover = read('../src/server/kaziProtectHandoverRoutes.ts');
  const issuance = read('../src/server/kaziProtectIssuanceRoutes.ts');
  const migration = read('../drizzle/0005_kazi_protect_handovers.sql');
  assert.match(handover, /beforeEvidenceRefs/);
  assert.match(handover, /afterEvidenceRefs/);
  assert.match(handover, /HANDOVER_SUBMITTED/);
  assert.match(handover, /HANDOVER_ACCEPTED/);
  assert.match(handover, /checklist\.every\(\(item\) => item\.completed\)/);
  assert.match(handover, /client_reservations = '[]'::jsonb/);
  assert.match(handover, /RESERVATIONS_RECORDED/);
  assert.match(handover, /Only the booking client can respond/);
  assert.match(issuance, /status = 'ACCEPTED'/);
  assert.match(issuance, /HANDOVER_NOT_ACCEPTED/);
  assert.match(migration, /booking_id uuid NOT NULL UNIQUE REFERENCES bookings/);
  assert.match(drizzle, /kaziProtectHandovers = pgTable/);
});

test('booking completion is gated by an accepted handover when one exists', () => {
  const logic = read('../src/server/businessLogic.ts');
  assert.match(logic, /params\.toStatus === 'COMPLETED'/);
  assert.match(logic, /kaziProtectHandovers/);
  assert.match(logic, /handover\.status !== 'ACCEPTED'/);
  assert.match(logic, /Client must accept the KAZI PROTECT handover/);
});
