CREATE TABLE IF NOT EXISTS candidate_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_profile_id uuid NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('CV', 'CERTIFICATE', 'DIPLOMA', 'OTHER')),
  original_file_name text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type = 'application/pdf'),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  scan_status text NOT NULL DEFAULT 'QUARANTINED' CHECK (scan_status IN ('QUARANTINED', 'SCANNING', 'CLEAN', 'REJECTED', 'DELETED')),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS candidate_documents_candidate_uploaded_idx
  ON candidate_documents(candidate_profile_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS candidate_documents_scan_status_idx
  ON candidate_documents(scan_status);

CREATE TABLE IF NOT EXISTS candidate_document_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES candidate_documents(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  consented_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT candidate_document_shares_document_application_unique
    UNIQUE (document_id, application_id)
);

CREATE INDEX IF NOT EXISTS candidate_document_shares_application_idx
  ON candidate_document_shares(application_id);
