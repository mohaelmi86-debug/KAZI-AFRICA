-- One contractual warranty per booking; prevents concurrent duplicate issuance.
-- This is additive and does not issue certificates or activate products.
CREATE UNIQUE INDEX IF NOT EXISTS kazi_protect_certificates_booking_contractual_warranty_uidx
  ON kazi_protect_certificates (booking_id, protection_kind)
  WHERE booking_id IS NOT NULL AND protection_kind = 'CONTRACTUAL_WARRANTY';
