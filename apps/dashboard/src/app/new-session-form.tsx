'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/**
 * Small client-side form that POSTs a game URL to the API and navigates to
 * the detail page once the backend hands us back a session id. We don't wait
 * for the run to finish — the detail page auto-refreshes until status stops
 * being "running".
 */
export function NewSessionForm({ apiBase }: { apiBase: string }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: trimmed,
          organizationId: '00000000-0000-0000-0000-000000000000',
          maxRounds: 1,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
      }
      const { sessionId } = (await res.json()) as { sessionId: string };
      router.push(`/sessions/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: 'flex',
        gap: 8,
        marginBottom: 24,
        padding: 12,
        background: '#0f1317',
        border: '1px solid #1f242a',
        borderRadius: 8,
      }}
    >
      <input
        type="url"
        required
        placeholder="https://your-game-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={submitting}
        style={{
          flex: 1,
          padding: '8px 12px',
          background: '#0b0d10',
          border: '1px solid #2c333b',
          borderRadius: 6,
          color: '#e5e7eb',
          fontSize: 13,
          fontFamily: 'ui-monospace, monospace',
          outline: 'none',
        }}
      />
      <button
        type="submit"
        disabled={submitting || !url.trim()}
        style={{
          padding: '8px 16px',
          background: submitting ? '#2c333b' : '#3b82f6',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: submitting ? 'default' : 'pointer',
        }}
      >
        {submitting ? 'Starting…' : 'Run test'}
      </button>
      {error && (
        <div
          style={{
            position: 'absolute',
            marginTop: 56,
            color: '#fca5a5',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
