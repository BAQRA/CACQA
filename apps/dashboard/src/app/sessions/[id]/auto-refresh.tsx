'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Polls the current route every N seconds while the session is still running.
 * Calling router.refresh() re-executes the server component, which re-fetches
 * session + rounds + failures — no websocket needed for MVP.
 */
export function AutoRefresh({ status, intervalMs = 3000 }: { status: string; intervalMs?: number }) {
  const router = useRouter();
  const active = status === 'queued' || status === 'running';

  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  if (!active) {
    return null;
  }
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        background: '#1e3a5f',
        color: '#93c5fd',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#60a5fa',
          animation: 'pulse 1.2s infinite',
        }}
      />
      auto-refreshing…
      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </div>
  );
}
