import { type Metadata } from 'next';
import { type ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'cacqa — autonomous game QA',
  description: 'Run, observe, and triage browser-based game tests.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#0b0d10',
          color: '#e6e8eb',
          minHeight: '100vh',
        }}
      >
        <header
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #1f242a',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <strong style={{ fontSize: 14, letterSpacing: 1 }}>CACQA</strong>
          <span style={{ color: '#7d8794', fontSize: 12 }}>autonomous game QA</span>
        </header>
        <main style={{ padding: 24 }}>{children}</main>
      </body>
    </html>
  );
}
