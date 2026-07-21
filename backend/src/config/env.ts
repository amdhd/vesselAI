import { z } from 'zod';

// Centralised, validated environment configuration. Every process.env read for
// operational config should go through this module so the app fails fast at boot
// with a clear message rather than misbehaving at runtime on a bad/missing var.
//
// NOTE: JWT_SECRET is deliberately NOT owned here — lib/jwtConfig.ts has bespoke
// dev-fallback + production-refusal logic and remains the single source for it.

// Accept common truthy spellings for boolean-ish env vars ("true"/"1"/"yes").
const boolish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),

    // Optional at the type level so the app can boot for local/demo use without a
    // database (routes degrade gracefully). Required in production — see refine below.
    DATABASE_URL: z.string().url().optional(),

    FRONTEND_URL: z.string().url().default('http://localhost:5173'),

    // Optional: the AI service falls back to canned responses when unset.
    ANTHROPIC_API_KEY: z.string().optional(),

    // Number of proxy hops, or 'true'/'false'. Left to app.ts to interpret.
    TRUST_PROXY: z.string().optional(),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

    // If set, GET /metrics requires `Authorization: Bearer <token>`.
    METRICS_TOKEN: z.string().optional(),

    ENABLE_WEATHER_SYNC: boolish,
    WEATHER_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

    AISSTREAM_API_KEY: z.string().optional(),
    ENABLE_AIS_STREAM: boolish,
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV === 'production' && !val.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required in production.',
      });
    }
  });

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Logger isn't up yet (it depends on this module) — use console for the one
    // boot-time failure, then exit so a misconfigured process never serves traffic.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    // eslint-disable-next-line no-console
    console.error(`[env] Invalid environment configuration:\n${issues.join('\n')}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

// Effective log level: explicit override, else silent under test (keep the suite
// output clean), quieter in prod, chatty in dev.
export const resolvedLogLevel = env.LOG_LEVEL ?? (isTest ? 'silent' : isProduction ? 'info' : 'debug');
