import Link from 'next/link';
import { notFound } from 'next/navigation';

import { artifactUrl, getSession, listFailures, listRounds, type Failure, type Round } from '@/lib/api';

import { AutoRefresh } from './auto-refresh';

export const dynamic = 'force-dynamic';

function severityColor(sev: Failure['severity']): string {
  switch (sev) {
    case 'critical':
      return '#f87171';
    case 'high':
      return '#fb923c';
    case 'medium':
      return '#fbbf24';
    case 'low':
      return '#a3e635';
    case 'info':
    default:
      return '#94a3b8';
  }
}

function RoundBlock({ round }: { round: Round }) {
  const tag = round.index < 0 ? 'pre-flight' : round.index === 0 ? 'initial' : `round ${round.index}`;
  return (
    <div
      style={{
        border: '1px solid #1f242a',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        background: '#0f1317',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 8,
          fontSize: 13,
        }}
      >
        <strong style={{ color: '#e5e7eb' }}>{tag}</strong>
        <span style={{ color: '#7d8794' }}>
          {round.observations.length} observation{round.observations.length === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {round.observations.map((obs) => (
          <figure key={obs.filename} style={{ margin: 0 }}>
            <a
              href={artifactUrl(obs.url)}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'block', borderRadius: 6, overflow: 'hidden', border: '1px solid #1f242a' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artifactUrl(obs.url)}
                alt={obs.label}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </a>
            <figcaption style={{ fontSize: 11, color: '#7d8794', marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
              {obs.label}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function FailureRow({ failure }: { failure: Failure }) {
  return (
    <div
      style={{
        border: '1px solid #1f242a',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        background: '#0f1317',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, fontSize: 13 }}>
        <span
          style={{
            color: severityColor(failure.severity),
            background: '#1a1f25',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontWeight: 600,
          }}
        >
          {failure.severity}
        </span>
        <span style={{ color: '#d1d5db', fontFamily: 'ui-monospace, monospace' }}>{failure.ruleId}</span>
        <span style={{ color: '#7d8794', marginLeft: 'auto' }}>{new Date(failure.observedAt).toLocaleTimeString()}</span>
      </div>
      <p style={{ color: '#e5e7eb', margin: '4px 0 8px', fontSize: 14 }}>{failure.message}</p>
      <div style={{ color: '#7d8794', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
        scenario: {failure.scenarioId}
        {failure.metadata ? ` · ${JSON.stringify(failure.metadata)}` : null}
      </div>
    </div>
  );
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [session, rounds, failures] = await Promise.all([
    getSession(id).catch(() => null),
    listRounds(id).catch(() => [] as Round[]),
    listFailures(id).catch(() => [] as Failure[]),
  ]);

  if (!session) {
    notFound();
  }

  return (
    <section style={{ maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/" style={{ color: '#60a5fa', fontSize: 13, textDecoration: 'none' }}>
          ← all sessions
        </Link>
        <AutoRefresh status={session.status} />
      </div>
      <h1 style={{ fontSize: 20, margin: '8px 0 4px', fontFamily: 'ui-monospace, monospace' }}>
        {session.sessionId.slice(0, 8)}…
      </h1>
      <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 24, fontFamily: 'ui-monospace, monospace' }}>
        {session.targetUrl}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        <Stat label="Status" value={session.status} />
        <Stat label="Rounds" value={`${session.roundsCompleted}/${session.maxRounds}`} />
        <Stat
          label="Failures"
          value={String(session.failureCount)}
          {...(session.failureCount > 0 && { accent: '#f87171' })}
        />
        <Stat label="Ended" value={session.endedAt ? new Date(session.endedAt).toLocaleString() : '—'} />
      </div>

      {failures.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: '24px 0 12px' }}>Failures</h2>
          {failures.map((f, i) => (
            <FailureRow key={`${f.roundId}-${i}`} failure={f} />
          ))}
        </>
      )}

      <h2 style={{ fontSize: 16, margin: '24px 0 12px' }}>Observations</h2>
      {rounds.length === 0 ? (
        <div style={{ color: '#7d8794', fontSize: 13 }}>No screenshots captured yet.</div>
      ) : (
        rounds.map((r) => <RoundBlock key={r.index} round={r} />)
      )}
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ border: '1px solid #1f242a', borderRadius: 8, padding: 12 }}>
      <div style={{ color: '#7d8794', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color: accent ?? '#e5e7eb', fontSize: 16, marginTop: 4 }}>{value}</div>
    </div>
  );
}
