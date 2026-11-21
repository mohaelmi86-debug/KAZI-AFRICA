-- KAZI PROTECT GLOBAL foundation; additive migration.
-- All country product lines remain disabled until country-specific approval.
CREATE TABLE IF NOT EXISTS kazi_protect_country_settings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 country_iso2 text NOT NULL UNIQUE REFERENCES countries(iso2) ON UPDATE CASCADE ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'NOT_REVIEWED' CHECK (status IN ('NOT_REVIEWED','IN_REVIEW','CONFIGURING','TESTING','READY','ACTIVE','SUSPENDED')),
 currency_code text,
 languages jsonb NOT NULL DEFAULT '[]'::jsonb,
 regulatory_review_status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (regulatory_review_status IN ('NOT_STARTED','IN_PROGRESS','APPROVED','REJECTED','EXPIRED')),
 regulatory_reviewed_at timestamptz,
 reviewer_organization text,
 regulatory_evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
 release_gates jsonb NOT NULL DEFAULT jsonb_build_object('legalReview',false,'partnerVerified',false,'wordingApproved',false,'claimsProcessReady',false,'privacyReview',false,'paymentFlowVerified',false,'countryUatPassed',false),
 config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kazi_protect_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_code text NOT NULL UNIQUE, name text NOT NULL,
 category text NOT NULL CHECK (category IN ('WARRANTY','INSURANCE','QUALITY_SERVICE','PAYMENT_PROTECTION')),
 description text NOT NULL DEFAULT '', requires_authorized_partner boolean NOT NULL DEFAULT false,
 is_globally_available boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kazi_protect_country_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 country_iso2 text NOT NULL REFERENCES countries(iso2) ON UPDATE CASCADE ON DELETE RESTRICT,
 product_id uuid NOT NULL REFERENCES kazi_protect_products(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'DISABLED' CHECK (status IN ('DISABLED','PENDING_REVIEW','APPROVED','ACTIVE','SUSPENDED')),
 partner_ids jsonb NOT NULL DEFAULT '[]'::jsonb, terms_version text, disclosure_version text,
 local_config jsonb NOT NULL DEFAULT '{}'::jsonb, approved_by text, approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(country_iso2, product_id)
);
CREATE TABLE IF NOT EXISTS kazi_protect_partners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 country_iso2 text NOT NULL REFERENCES countries(iso2) ON UPDATE CASCADE ON DELETE RESTRICT,
 partner_type text NOT NULL CHECK (partner_type IN ('INSURER','BROKER','INTERMEDIARY','EXPERT','QUALITY_PROVIDER','PAYMENT_PROVIDER')),
 legal_name text NOT NULL, registration_reference text, authorization_reference text,
 authorization_verified_at timestamptz, authorization_evidence_ref text,
 territories jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION','VERIFIED','SUSPENDED','TERMINATED')),
 contact_config jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kazi_protect_certificates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), certificate_number text NOT NULL UNIQUE, verification_token_hash text NOT NULL UNIQUE,
 country_iso2 text NOT NULL REFERENCES countries(iso2) ON UPDATE CASCADE ON DELETE RESTRICT,
 owner_profile_id uuid REFERENCES profiles(id) ON DELETE RESTRICT, mission_id uuid REFERENCES missions(id) ON DELETE RESTRICT,
 booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT,
 protected_object_type text NOT NULL CHECK (protected_object_type IN ('SERVICE','WORK','PRODUCT','DELIVERY')),
 protected_object_id uuid,
 protection_kind text NOT NULL CHECK (protection_kind IN ('CONTRACTUAL_WARRANTY','INSURER_POLICY','QUALITY_RECORD','PAYMENT_PROTECTION')),
 issuer_type text NOT NULL CHECK (issuer_type IN ('KAZI','PROFESSIONAL','INSURER','AUTHORIZED_PARTNER')),
 issuer_partner_id uuid REFERENCES kazi_protect_partners(id) ON DELETE RESTRICT, external_policy_reference text,
 coverage_summary jsonb NOT NULL DEFAULT '{}'::jsonb, exclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
 starts_at timestamptz, ends_at timestamptz,
 status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','ACTIVE','EXPIRED','CANCELLED','REVOKED')),
 document_storage_ref text, issued_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
 CHECK (protection_kind <> 'INSURER_POLICY' OR (issuer_type = 'INSURER' AND issuer_partner_id IS NOT NULL AND external_policy_reference IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS kazi_protect_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_number text NOT NULL UNIQUE,
 country_iso2 text NOT NULL REFERENCES countries(iso2) ON UPDATE CASCADE ON DELETE RESTRICT,
 certificate_id uuid REFERENCES kazi_protect_certificates(id) ON DELETE RESTRICT,
 claimant_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
 claim_type text NOT NULL CHECK (claim_type IN ('WARRANTY_REPAIR','SERVICE_COMPLAINT','PRODUCT_DEFECT','DELIVERY_DAMAGE','INSURANCE_NOTICE','OTHER')),
 description text NOT NULL, evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','TRIAGE','INFO_REQUIRED','ASSIGNED','PARTNER_REVIEW','EXPERT_REVIEW','ACCEPTED','REJECTED','REPAIR_IN_PROGRESS','SETTLED','CLOSED')),
 assigned_partner_id uuid REFERENCES kazi_protect_partners(id) ON DELETE RESTRICT, insurer_decision_reference text,
 resolution_summary text, submitted_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kazi_protect_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), country_iso2 text NOT NULL REFERENCES countries(iso2) ON UPDATE CASCADE ON DELETE RESTRICT,
 actor_uid text, entity_type text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL,
 before_state jsonb, after_state jsonb, request_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kazi_protect_country_products_country_status_idx ON kazi_protect_country_products(country_iso2,status);
CREATE INDEX IF NOT EXISTS kazi_protect_certificates_owner_idx ON kazi_protect_certificates(owner_profile_id,created_at DESC);
CREATE INDEX IF NOT EXISTS kazi_protect_certificates_mission_idx ON kazi_protect_certificates(mission_id);
CREATE INDEX IF NOT EXISTS kazi_protect_claims_country_status_idx ON kazi_protect_claims(country_iso2,status,submitted_at DESC);
CREATE INDEX IF NOT EXISTS kazi_protect_audit_entity_idx ON kazi_protect_audit_events(entity_type,entity_id,created_at DESC);
INSERT INTO kazi_protect_products (product_code,name,category,description,requires_authorized_partner) VALUES
 ('SERVICE_WARRANTY','Service workmanship warranty','WARRANTY','Contractual remedy commitment with explicit scope, exclusions and duration.',false),
 ('PRODUCT_WARRANTY','Product warranty','WARRANTY','Manufacturer or seller warranty record; issuer and terms must be explicit.',false),
 ('WORKMANSHIP_GUARANTEE','Workmanship guarantee','WARRANTY','Professional contractual commitment for eligible completed works.',false),
 ('DELIVERY_PROTECTION','Delivery protection','PAYMENT_PROTECTION','Delivery evidence and contractual remedy workflow; insurance only when partner-issued.',false),
 ('ACCIDENTAL_DAMAGE_INSURANCE','Accidental damage insurance','INSURANCE','Insurance product; authorized partner and country approval required.',true),
 ('PROFESSIONAL_LIABILITY_INSURANCE','Professional liability insurance','INSURANCE','Insurance product; authorized partner and country approval required.',true),
 ('CONSTRUCTION_INSURANCE','Construction insurance','INSURANCE','Insurance product; country-specific eligibility and authorization required.',true),
 ('HOME_INSURANCE','Home insurance','INSURANCE','Insurance product; country-specific eligibility and authorization required.',true),
 ('EQUIPMENT_BREAKDOWN_INSURANCE','Equipment breakdown insurance','INSURANCE','Insurance product; authorized partner and country approval required.',true),
 ('QUALITY_INSPECTION','Quality inspection','QUALITY_SERVICE','Inspection and handover service, not an insurance contract.',false)
ON CONFLICT (product_code) DO NOTHING;
-- Country-specific settings are provisioned only after the canonical country registry exists.
-- This migration intentionally does not activate any country or product.
