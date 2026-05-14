import { Wordmark } from '@/components/brand/wordmark';
import { buttonVariants } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export default function LandingPage(): JSX.Element {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-steel">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[-10rem] h-[40rem] bg-orange-glow-radial"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange shadow-orange-glow">
            <span className="font-condensed text-lg font-extrabold text-white">T</span>
          </div>
          <span className="font-condensed text-lg font-extrabold uppercase tracking-wide">
            US <span className="text-orange">Tow</span> Dispatch
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 pb-16 text-center md:px-10">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-steel-border bg-steel-mid/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-text-secondary backdrop-blur animate-fade-in-up">
          <span className="h-1.5 w-1.5 rounded-full bg-orange shadow-orange-glow" />
          US Tow Alliance member preview
        </span>

        <Wordmark className="animate-fade-in-up" />

        <p className="mt-6 max-w-3xl font-condensed text-2xl font-bold text-text-primary md:text-3xl animate-fade-in-up">
          The operating system owned by you, built by you.
        </p>

        <p className="mt-5 max-w-2xl text-base leading-relaxed text-text-secondary md:text-lg animate-fade-in-up">
          Owned and built by the operators, for the operators. The AI-powered operating system for
          every US Tow Alliance member. Every integration is a 1st-class member, unlike the legacy
          systems of the present and past. Built on today's tech stack, designed for the future that
          is in front of us. Membership provides pricing benefits unmatched by today's legacy
          software.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4 animate-fade-in-up">
          <Link
            href="/signup"
            className={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'min-w-44')}
          >
            Get started
          </Link>
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'lg' }),
              'min-w-44 text-text-secondary',
            )}
          >
            Sign in
          </Link>
        </div>

        <p className="mt-6 font-mono text-xs uppercase tracking-[0.3em] text-text-muted">
          No credit card · Self-host or cloud · Open data export
        </p>
      </section>

      <footer className="relative z-10 border-t border-steel-border bg-steel-mid/40 px-6 py-6 md:px-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-xs uppercase tracking-[0.25em] text-text-muted sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-steel-border bg-steel-light">
              <span className="font-condensed text-[10px] font-extrabold text-orange-light">
                USTA
              </span>
            </div>
            <span className="font-mono text-[11px] tracking-[0.2em]">US Tow Alliance</span>
          </div>
          <span className="font-mono text-[11px] tracking-[0.2em]">
            Powered by <span className="text-text-secondary">Blue Collar AI</span>
          </span>
        </div>
      </footer>
    </main>
  );
}
