export interface EnvValidationReport {
  ok: boolean;
  mode: string;
  missingRequiredInProd: string[];
  optionalUnconfigured: string[];
  warnings: string[];
}

export function validateRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env
): EnvValidationReport {
  const mode = env.NODE_ENV || 'development';
  const isProd = mode === 'production';

  const requiredInProd = [
    'SQL_HOST',
    'SQL_USER',
    'SQL_PASSWORD',
    'SQL_DB_NAME',
    'PAYMENT_WEBHOOK_SECRET',
    'APP_URL',
  ];

  const optionalKeys = ['GEMINI_API_KEY', 'CORS_ALLOWED_ORIGINS'];

  const missingRequiredInProd = requiredInProd.filter((k) => !env[k] || String(env[k]).trim() === '');
  const optionalUnconfigured = optionalKeys.filter((k) => !env[k] || String(env[k]).trim() === '');

  const warnings: string[] = [];
  if (isProd && missingRequiredInProd.length > 0) {
    warnings.push(`Missing production environment variables: ${missingRequiredInProd.join(', ')}`);
  }
  if (!isProd && !env.PAYMENT_WEBHOOK_SECRET) {
    warnings.push('PAYMENT_WEBHOOK_SECRET not set; using ephemeral in-memory dev/test secret.');
  }
  if (!env.GEMINI_API_KEY) {
    warnings.push('GEMINI_API_KEY not configured; /api/ai/* endpoints will return 502.');
  }

  return {
    ok: !isProd || missingRequiredInProd.length === 0,
    mode,
    missingRequiredInProd,
    optionalUnconfigured,
    warnings,
  };
}
