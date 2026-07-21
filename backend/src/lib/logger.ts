import pino from 'pino';
import { env, resolvedLogLevel, isProduction } from '../config/env';

// Single structured (JSON) logger for the whole process. JSON in every
// environment so logs are machine-parseable by whatever ships them in
// production (Loki, CloudWatch, Datadog, …) — no pretty-printer dependency that
// would be absent from the slim prod image.
//
// `redact` scrubs anything that could carry a secret (auth headers, tokens) so a
// stray request-log or error never leaks a credential.
export const logger = pino({
  level: resolvedLogLevel,
  base: { service: 'vesselmind-api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'password',
      '*.password',
      'token',
      '*.token',
      'apiKey',
      'ANTHROPIC_API_KEY',
      'AISSTREAM_API_KEY',
    ],
    censor: '[redacted]',
  },
  // Millisecond ISO timestamps in prod; pino's default (epoch ms) is fine in dev.
  ...(isProduction ? { timestamp: pino.stdTimeFunctions.isoTime } : {}),
});

// Convenience for module-scoped child loggers, e.g. logger.child({ mod: 'ais' }).
export const childLogger = (bindings: Record<string, unknown>) => logger.child(bindings);
