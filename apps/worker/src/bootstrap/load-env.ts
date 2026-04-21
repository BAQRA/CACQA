import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Loads `.env` from the monorepo root. We don't crash if it's missing — env
 * validation in @cacqa/config will surface any required-but-unset variables
 * with a readable diagnostic at boot time.
 *
 * Import this module FIRST in every entry point, before anything that reads
 * process.env. Using a side-effect import keeps the call site to one line.
 */
const here = dirname(fileURLToPath(import.meta.url));
// apps/worker/src/bootstrap/ → repo root is 4 levels up
const envPath = resolve(here, '..', '..', '..', '..', '.env');

try {
  loadEnvFile(envPath);
} catch {
  // .env is optional — env vars may come from the host instead.
}
