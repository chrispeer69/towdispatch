import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

/**
 * Self-serve recovery portal shell (Session 55). Public, account-less,
 * mobile-first (≈80% of traffic is phones). Kept separate from the S32
 * /portal account portal. Tenant branding is resolved server-side by host on
 * the API; this shell stays neutral and content-driven.
 */
export default function RecoverLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto w-full max-w-md px-4 py-6 sm:py-10">{children}</main>
    </div>
  );
}
