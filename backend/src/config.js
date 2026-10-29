export function loadConfig(env) {
  const isProd = env.NODE_ENV === 'production';

  const secret = (name, fallback) => {
    if (env[name]) return env[name];
    if (isProd) throw new Error(`Variável de ambiente ${name} é obrigatória em produção`);
    return fallback;
  };

  return {
    isProd,
    // silent nos testes; info em produção; LOG_LEVEL sobrescreve (trace|debug|info|warn|error|fatal|silent)
    logLevel: env.LOG_LEVEL || (env.NODE_ENV === 'test' ? 'silent' : 'info'),
    logPretty: !isProd && env.NODE_ENV !== 'test' && env.LOG_PRETTY !== 'false',
    port: Number(env.PORT || 3001),
    databaseUrl: env.DATABASE_URL || 'postgres://leilao:leilao@localhost:5432/leilao',
    jwtSecret: secret('JWT_SECRET', 'dev-jwt-secret'),
    // Segredo do HMAC da cadeia de lances. Fica FORA do banco: quem só tem acesso ao
    // banco não consegue recalcular hashes válidos depois de adulterar o histórico.
    hashSecret: secret('HASH_SECRET', 'dev-hash-secret'),
    antiSnipingMs: 2 * 60 * 1000,
    schedulerIntervalMs: 1000,
    catalogUrl: 'https://openaccess-api.clevelandart.org/api/artworks/',
  };
}

export const config = loadConfig(process.env);
