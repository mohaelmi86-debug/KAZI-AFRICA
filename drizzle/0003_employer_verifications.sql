CREATE TABLE IF NOT EXISTS employer_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  registration_number text NOT NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED', 'MORE_INFO_REQUIRED')),
  submitted_at timestamp NOT NULL DEFAULT now(),
  reviewed_by_profile_id uuid REFERENCES profiles(id),
  reviewed_at timestamp,
  review_note text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT employer_verification_review_consistency_chk
    CHECK ((status = 'PENDING' AND reviewed_at IS NULL) OR status <> 'PENDING')
);
CREATE INDEX IF NOT EXISTS employer_verifications_status_submitted_idx
  ON employer_verifications(status, submitted_at DESC);
