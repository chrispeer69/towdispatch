'use client';

/**
 * View toggle on /settings/services — switches between the Catalog view
 * (structural CRUD on services) and the Rate Sheet view (inline-editable
 * price grid). Lifted into its own client island so the rest of the page
 * can stay an RSC.
 *
 * The toggle owns no state itself; it just renders the children for the
 * active view and updates the URL via a shallow query param so the choice
 * survives a refresh and is shareable via link.
 */
import { cn } from '@/lib/utils';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useCallback, useMemo } from 'react';

export type ServicesView = 'catalog' | 'rate_sheet';

interface Props {
  catalog: ReactNode;
  rateSheet: ReactNode;
}

export function ServicesViewToggle({ catalog, rateSheet }: Props): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const view: ServicesView = useMemo(() => {
    const v = params.get('view');
    return v === 'rate_sheet' ? 'rate_sheet' : 'catalog';
  }, [params]);

  const setView = useCallback(
    (next: ServicesView) => {
      const sp = new URLSearchParams(params);
      if (next === 'catalog') sp.delete('view');
      else sp.set('view', next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-[10px] border border-divider bg-bg-surface p-0.5">
        <ViewButton active={view === 'catalog'} onClick={() => setView('catalog')}>
          Catalog
        </ViewButton>
        <ViewButton active={view === 'rate_sheet'} onClick={() => setView('rate_sheet')}>
          Rate Sheet
        </ViewButton>
      </div>
      {view === 'catalog' ? catalog : rateSheet}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-[8px] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
        active
          ? 'bg-brand-primary/15 text-brand-primary'
          : 'text-text-secondary-on-dark hover:text-text-primary-on-dark',
      )}
    >
      {children}
    </button>
  );
}
