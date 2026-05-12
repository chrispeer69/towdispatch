'use client';

/**
 * App-shell error boundary. Next.js calls this only when an error escapes
 * every route segment's error.tsx — typically a render failure in the
 * root layout itself. Must define its own <html> and <body> because the
 * root layout has already failed by the time this renders.
 */
import { AlertOctagon } from 'lucide-react';
import { useEffect } from 'react';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global-error]', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          backgroundColor: '#1A1E2A',
          color: '#FFFFFF',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <section
          role="alert"
          aria-live="assertive"
          style={{
            maxWidth: 480,
            border: '1px solid rgba(239,68,68,0.3)',
            backgroundColor: 'rgba(239,68,68,0.05)',
            borderRadius: 8,
            padding: '48px 24px',
            textAlign: 'center',
          }}
        >
          <AlertOctagon size={48} strokeWidth={1.5} color="#EF4444" aria-hidden="true" />
          <h1 style={{ marginTop: 16, fontSize: 24 }}>Server error</h1>
          <p style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>
            TowCommand hit an unexpected error. Our team has been notified.
          </p>
          {error.digest ? (
            <code
              style={{
                display: 'inline-block',
                marginTop: 16,
                padding: '4px 12px',
                fontSize: 12,
                backgroundColor: '#252B3B',
                borderRadius: 4,
                userSelect: 'all',
              }}
            >
              ref: {error.digest}
            </code>
          ) : null}
          <div style={{ marginTop: 24 }}>
            <button
              type="button"
              onClick={reset}
              style={{
                height: 40,
                padding: '0 16px',
                backgroundColor: '#FF6A2C',
                color: 'white',
                border: 'none',
                borderRadius: 10,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </section>
      </body>
    </html>
  );
}
