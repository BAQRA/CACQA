import Link from 'next/link';

import { listSessions, type Session } from '@/lib/api';

import { NewSessionForm } from './new-session-form';

export const dynamic = 'force-dynamic';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return '#4ade80';
    case 'running':
      return '#60a5fa';
    case 'failed':
      return '#f87171';
    case 'cancelled':
      return '#9ca3af';
    case 'queued':
    default:
      return '#e5e7eb';
  }
}

function formatTimestamp(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function shortenUrl(url: string, max = 60): string {
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
}

async function SessionRow({ session }: { session: Session }) {
  const failureBadge =
    session.failureCount > 0 ? (
      <span
        style={{
          background: '#3b1d1d',
          color: '#f87171',
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {session.failureCount} {session.failureCount === 1 ? 'failure' : 'failures'}
      </span>
    ) : (
      <span style={{ color: '#4ade80', fontSize: 12 }}>0 failures</span>
    );

  return (
    <Link
      href={`/sessions/${session.sessionId}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr 120px 140px 140px',
        gap: 16,
        alignItems: 'center',
        padding: '14px 16px',
        borderBottom: '1px solid #1f242a',
        textDecoration: 'none',
        color: 'inherit',
        fontSize: 13,
      }}
    >
      <span style={{ color: statusColor(session.status), fontWeight: 600 }}>{session.status}</span>
      <span title={session.targetUrl} style={{ color: '#d1d5db', fontFamily: 'ui-monospace, monospace' }}>
        {shortenUrl(session.targetUrl)}
      </span>
      <span style={{ color: '#9ca3af' }}>
        {session.roundsCompleted}/{session.maxRounds} rounds
      </span>
      {failureBadge}
      <span style={{ color: '#7d8794', textAlign: 'right' }}>
        {formatTimestamp(session.endedAt ?? session.startedAt)}
      </span>
    </Link>
  );
}

export default async function HomePage() {
  const sessions = await listSessions().catch(() => null);

  if (!sessions) {
    return (
      <section style={{ maxWidth: 960 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Sessions</h1>
        <div style={{ padding: 16, border: '1px dashed #7f1d1d', borderRadius: 8, color: '#fca5a5' }}>
          Could not reach the API at {process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'}.
          Start it with <code style={{ color: '#fde68a' }}>pnpm --filter @cacqa/api dev</code>.
        </div>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Sessions</h1>
      <p style={{ color: '#9aa3ad', marginBottom: 16 }}>
        Paste a game URL below to run a test against it. Browser sessions land
        here as the worker completes them.
      </p>
      <NewSessionForm apiBase={API_BASE} />
      <p style={{ color: '#9aa3ad', marginBottom: 12, fontSize: 13 }}>
        {sessions.length} session{sessions.length === 1 ? '' : 's'} · most recent first
      </p>
      {sessions.length === 0 ? (
        <div
          style={{
            padding: 24,
            border: '1px dashed #2c333b',
            borderRadius: 8,
            color: '#7d8794',
            fontSize: 14,
          }}
        >
          No sessions yet — submit the form above.
        </div>
      ) : (
        <div style={{ border: '1px solid #1f242a', borderRadius: 8, overflow: 'hidden' }}>
          {sessions.map((s) => (
            <SessionRow key={s.sessionId} session={s} />
          ))}
        </div>
      )}
    </section>
  );
}
