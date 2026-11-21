ALTER TABLE employment_contracts
  ADD COLUMN IF NOT EXISTS document_sha256 text,
  ADD COLUMN IF NOT EXISTS document_size_bytes integer,
  ADD COLUMN IF NOT EXISTS document_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_version integer NOT NULL DEFAULT 0;

ALTER TABLE employment_contracts
  ADD CONSTRAINT employment_contracts_document_integrity_check
  CHECK (
    (document_storage_path IS NULL AND document_sha256 IS NULL AND document_size_bytes IS NULL AND document_generated_at IS NULL AND document_version = 0)
    OR
    (document_storage_path IS NOT NULL AND document_sha256 ~ '^[0-9a-f]{64}$'
      AND document_size_bytes > 0 AND document_generated_at IS NOT NULL AND document_version > 0)
  );
