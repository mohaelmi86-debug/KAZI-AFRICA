-- Idempotent claim submission support for KAZI PROTECT.
ALTER TABLE kazi_protect_claims ADD COLUMN IF NOT EXISTS idempotency_key text;
UPDATE kazi_protect_claims
SET idempotency_key = 'legacy-' || id::text
WHERE idempotency_key IS NULL;
ALTER TABLE kazi_protect_claims ALTER COLUMN idempotency_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kazi_protect_claims_claimant_idempotency_idx
  ON kazi_protect_claims(claimant_profile_id, idempotency_key);
