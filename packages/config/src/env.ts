import { z } from 'zod';

const stringToBool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().default('cacqa-artifacts'),
  S3_FORCE_PATH_STYLE: stringToBool.default(true),

  LLM_PROVIDER: z.enum(['gemini', 'claude', 'mock']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
  WORKER_HEADLESS: stringToBool.default(true),
  WORKER_ARTIFACT_DIR: z.string().default('./artifacts'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates process.env. Throws with a readable diagnostic if invalid —
 * we fail fast at boot rather than discovering a misconfig mid-run.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Partial loader for contexts where only a subset is needed (e.g. dashboard on
 * the edge). Consumers should destructure only what they use.
 */
export function loadEnvPartial<K extends keyof Env>(
  keys: readonly K[],
  source: NodeJS.ProcessEnv = process.env,
): Pick<Env, K> {
  const full = loadEnv(source);
  return keys.reduce(
    (acc, k) => {
      acc[k] = full[k];
      return acc;
    },
    {} as Pick<Env, K>,
  );
}
