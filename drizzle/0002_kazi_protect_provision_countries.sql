-- Provision KAZI PROTECT baseline settings for every country already present in the canonical 54-country registry.
-- Safe to re-run. All products remain DISABLED and all country gates remain false.
INSERT INTO kazi_protect_country_settings (country_iso2, status, currency_code, languages)
SELECT c.iso2, 'NOT_REVIEWED', c.default_currency, COALESCE(c.supported_languages, '[]'::jsonb)
FROM countries c
ON CONFLICT (country_iso2) DO NOTHING;

INSERT INTO kazi_protect_country_products (country_iso2, product_id, status)
SELECT c.iso2, p.id, 'DISABLED'
FROM countries c
CROSS JOIN kazi_protect_products p
ON CONFLICT (country_iso2, product_id) DO NOTHING;

-- Safety assertion: deployment is considered incomplete unless every country in the
-- canonical registry has exactly one KAZI PROTECT settings row.
DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM countries c
  LEFT JOIN kazi_protect_country_settings s ON s.country_iso2 = c.iso2
  WHERE s.country_iso2 IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'KAZI PROTECT country provisioning incomplete: % countries missing', missing_count;
  END IF;
END $$;
