ALTER TABLE employer_verifications
  ADD COLUMN IF NOT EXISTS review_evidence_reference text;
