-- Evidence-based work handover; no automatic booking completion.
CREATE TABLE IF NOT EXISTS kazi_protect_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
  client_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  professional_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  before_evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  after_evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  work_summary text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','ACCEPTED','RESERVATIONS_RECORDED','REJECTED')),
  submitted_by_profile_id uuid REFERENCES profiles(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  client_reservations jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_response text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(checklist) = 'array'),
  CHECK (jsonb_typeof(before_evidence_refs) = 'array'),
  CHECK (jsonb_typeof(after_evidence_refs) = 'array'),
  CHECK (jsonb_typeof(client_reservations) = 'array')
);
CREATE INDEX IF NOT EXISTS kazi_protect_handovers_country_status_idx
  ON kazi_protect_handovers(country_id, status, created_at DESC);
