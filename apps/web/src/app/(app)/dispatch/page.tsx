import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/session';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

export const metadata = { title: 'Dispatch — TowCommand' };

interface SearchParams {
  created?: string;
}

/**
 * Placeholder dispatch screen — the live dispatch board lands in Session 5.
 * For now it acts as the success destination from /intake's DISPATCH button:
 * if a `?created=YYYYMMDD-NNNN` query param is set, surface a confirmation
 * banner so the dispatcher knows the job landed.
 */
export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  await requireUser();
  const params = await searchParams;
  const createdJobNumber = params.created ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          Live Dispatch
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          The full dispatch board lands in Session 5. For now this is the destination after a
          successful call intake.
        </p>
      </header>

      {createdJobNumber ? (
        <div
          data-testid="intake-success-toast"
          className="flex items-start gap-3 rounded-[12px] border border-ok/30 bg-ok/10 px-4 py-3"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-ok" />
          <div>
            <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-ok">
              Job #{createdJobNumber} created.
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              The job is captured, audited, and waiting in the new bucket. Future Session 5 will
              hand it off to a driver from here.
            </p>
          </div>
          <Link href="/intake" className="ml-auto">
            <Button variant="secondary" size="sm">
              New call
            </Button>
          </Link>
        </div>
      ) : null}

      <section className="rounded-[14px] border border-dashed border-steel-border bg-steel-mid/40 p-10 text-center">
        <p className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary">
          Dispatch board — coming in Session 5.
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          For now jobs queue up in the database with status = "new" until the live board ships.
        </p>
        <Link href="/intake" className="mt-6 inline-block">
          <Button>Take another call</Button>
        </Link>
      </section>
    </div>
  );
}
