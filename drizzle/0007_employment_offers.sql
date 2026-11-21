CREATE TABLE IF NOT EXISTS employment_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  job_post_id uuid NOT NULL REFERENCES job_posts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_profile_id uuid NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES countries(id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'SENT'
    CHECK (status IN ('SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'SUPERSEDED', 'EXPIRED')),
  job_title_snapshot text NOT NULL,
  contract_type text NOT NULL,
  salary_amount numeric(14,2) NOT NULL CHECK (salary_amount > 0),
  salary_basis text NOT NULL DEFAULT 'GROSS' CHECK (salary_basis IN ('GROSS', 'NET')),
  salary_currency text NOT NULL CHECK (salary_currency ~ '^[A-Z]{3}$'),
  pay_frequency text NOT NULL CHECK (pay_frequency IN ('HOUR', 'WEEK', 'MONTH', 'YEAR')),
  start_date text NOT NULL,
  work_location text NOT NULL,
  weekly_hours numeric(5,2) CHECK (weekly_hours IS NULL OR (weekly_hours > 0 AND weekly_hours <= 168)),
  probation_days integer CHECK (probation_days IS NULL OR (probation_days >= 0 AND probation_days <= 365)),
  benefits text,
  additional_conditions text,
  local_law_notice text,
  expires_at timestamptz NOT NULL,
  candidate_response_at timestamptz,
  candidate_response_note text,
  created_by_profile_id uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employment_offers_application_version_unique UNIQUE (application_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS employment_offers_one_sent_per_application_idx
  ON employment_offers(application_id) WHERE status = 'SENT';

CREATE INDEX IF NOT EXISTS employment_offers_candidate_status_idx
  ON employment_offers(candidate_profile_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS employment_offers_org_status_idx
  ON employment_offers(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS employment_offers_application_status_idx
  ON employment_offers(application_id, status, created_at DESC);
