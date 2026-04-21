/**
 * Thin typed API client for the cacqa backend. All calls are server-side
 * fetches from Next.js server components — no browser-visible token needed.
 * We hard-fail on non-2xx so pages throw to the error boundary.
 */

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export interface Session {
  readonly sessionId: string;
  readonly organizationId: string;
  readonly targetUrl: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly roundsCompleted: number;
  readonly failureCount: number;
  readonly maxRounds: number;
}

export interface Failure {
  readonly sessionId: string;
  readonly roundId?: string;
  readonly scenarioId: string;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly ruleId: string;
  readonly message: string;
  readonly observedAt: string;
  readonly artifacts: {
    readonly screenshotBefore?: string;
    readonly screenshotAfter?: string;
  };
  readonly metadata?: Record<string, unknown>;
}

export interface RoundObservation {
  readonly filename: string;
  readonly label: string;
  readonly url: string;
}

export interface Round {
  readonly index: number;
  readonly observations: readonly RoundObservation[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    // Sessions change while worker runs — don't aggressively cache in dev.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function listSessions(limit = 50): Promise<Session[]> {
  const { items } = await get<{ items: Session[] }>(`/sessions?limit=${limit}`);
  return items;
}

export async function getSession(id: string): Promise<Session> {
  return get<Session>(`/sessions/${id}`);
}

export async function listFailures(id: string): Promise<Failure[]> {
  const { items } = await get<{ items: Failure[] }>(`/sessions/${id}/failures`);
  return items;
}

export async function listRounds(id: string): Promise<Round[]> {
  const { items } = await get<{ items: Round[] }>(`/sessions/${id}/rounds`);
  return items;
}

export interface CreateSessionResult {
  readonly sessionId: string;
  readonly jobId: string;
  readonly status: 'queued';
}

export async function createSession(input: {
  targetUrl: string;
  organizationId?: string;
  maxRounds?: number;
}): Promise<CreateSessionResult> {
  const body = {
    targetUrl: input.targetUrl,
    organizationId: input.organizationId ?? '00000000-0000-0000-0000-000000000000',
    maxRounds: input.maxRounds ?? 1,
  };
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Create session failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as CreateSessionResult;
}

/** Returns an absolute artifact URL for <img src="..."> binding. */
export function artifactUrl(path: string): string {
  // `path` is already `/api/artifacts/...` from the rounds endpoint.
  return `${API_BASE}${path}`;
}
