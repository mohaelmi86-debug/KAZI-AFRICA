CREATE TABLE IF NOT EXISTS employment_contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('fr', 'en', 'pt', 'ar')),
  contract_type text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'REVIEW', 'APPROVED', 'RETIRED')),
  legal_review_reference text,
  validated_by_profile_id uuid REFERENCES profiles(id),
  validated_at timestamptz,
  created_by_profile_id uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employment_contract_templates_country_lang_type_version_unique
    UNIQUE (country_id, language, contract_type, version),
  CONSTRAINT employment_contract_templates_approval_evidence_check
    CHECK (status <> 'APPROVED' OR
      (validated_by_profile_id IS NOT NULL AND validated_at IS NOT NULL
       AND legal_review_reference IS NOT NULL AND length(trim(legal_review_reference)) > 0))
);

CREATE INDEX IF NOT EXISTS employment_contract_templates_country_status_idx
  ON employment_contract_templates(country_id, status);

CREATE TABLE IF NOT EXISTS employment_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL UNIQUE REFERENCES employment_offers(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL REFERENCES job_applications(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  candidate_profile_id uuid NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  country_id uuid NOT NULL REFERENCES countries(id),
  template_id uuid NOT NULL REFERENCES employment_contract_templates(id) ON DELETE RESTRICT,
  template_version integer NOT NULL CHECK (template_version > 0),
  language text NOT NULL CHECK (language IN ('fr', 'en', 'pt', 'ar')),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_SIGNATURE', 'PARTIALLY_SIGNED', 'SIGNED', 'ACTIVE', 'AMENDED', 'TERMINATED', 'EXPIRED', 'CANCELLED')),
  terms_snapshot jsonb NOT NULL,
  document_storage_path text,
  signature_provider text,
  provider_envelope_id text,
  signed_at timestamptz,
  created_by_profile_id uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employment_contracts_signature_state_check
    CHECK (status NOT IN ('SIGNED', 'ACTIVE') OR (signed_at IS NOT NULL AND document_storage_path IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS employment_contracts_org_status_idx
  ON employment_contracts(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS employment_contracts_candidate_status_idx
  ON employment_contracts(candidate_profile_id, status, created_at DESC);
