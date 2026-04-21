import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '..', '..', '..', '.env');

try {
  loadEnvFile(envPath);
} catch {
  // .env is optional in production where env vars come from the host.
}
