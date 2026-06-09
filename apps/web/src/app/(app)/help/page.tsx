/**
 * /help — the help center landing.
 *
 * Today this is a placeholder with two cards: Training Documents and
 * Chat Support, both marked "Coming soon". When training docs ship,
 * the first card becomes a list of articles / a search box / an
 * embedded knowledge-base; the second card swaps to a chat-request
 * widget (Intercom / Crisp / our own minimal form).
 *
 * Routed from the topbar question-mark button — see
 * apps/web/src/components/app-shell/topbar.tsx.
 */
import { BookOpen, MessageSquare } from 'lucide-react';
import type { JSX } from 'react';

export const metadata = { title: 'Help center — Tow Dispatch' };

export default function HelpCenterPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          Help center
        </h1>
        <p className="max-w-prose text-sm text-text-secondary-on-dark">
          Training documents and live chat support will live here. Both are in flight — pick the
          card below that matches what you need and we&rsquo;ll route you there when it&rsquo;s
          ready.
        </p>
      </header>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-bg-surface-elevated text-brand-primary">
            <BookOpen className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-text-primary-on-dark">Training documents</h2>
              <span className="rounded-full bg-bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                Coming soon
              </span>
            </div>
            <p className="mt-1 text-sm text-text-secondary-on-dark">
              Step-by-step guides for call intake, dispatch, billing, fleet, and accounting.
              Searchable, role-tagged (Dispatcher / Driver / Admin), and printable.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-bg-surface-elevated text-brand-primary">
            <MessageSquare className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-text-primary-on-dark">Chat support</h2>
              <span className="rounded-full bg-bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                Coming soon
              </span>
            </div>
            <p className="mt-1 text-sm text-text-secondary-on-dark">
              Open a chat request to the Tow Dispatch support team. Replies on business days,
              priority for production-blocking issues.
            </p>
          </div>
        </div>
      </section>

      <p className="text-xs text-text-secondary-on-dark">
        Need urgent help in the meantime? Email{' '}
        <a className="text-brand-primary hover:underline" href="mailto:support@towdispatch.cloud">
          support@towdispatch.cloud
        </a>
        .
      </p>
    </div>
  );
}
