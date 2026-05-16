'use client';

import { cn } from '@/lib/utils';
import type { AuthTenantDto, AuthUserDto } from '@ustowdispatch/shared';
import {
  Building2,
  Calculator,
  CarFront,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Mail,
  Navigation,
  PhoneCall,
  Radio,
  Receipt,
  Settings,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
} from 'lucide-react';
/**
 * 240px-wide left sidebar. Pulls the active path from `usePathname()` so the
 * matching pill highlights when on that route. The only remaining disabled
 * item is Email Settings — no settings UI exists yet.
 *
 * Per-item accentColor: ECOSYSTEM tabs (CONVINI, FleetCommand, FleetGuard Pro)
 * each get a brand color used for the icon at all times, the text + 3px
 * indicator bar when active, an 8%-tint background when active, and a
 * 4%-tint background on hover. Implemented by writing the per-item color +
 * derived tints as CSS custom properties on the link, so Tailwind's
 * arbitrary-value classes can reference them for hover (which inline `style`
 * can't express). Avoids enumerating every brand color in the Tailwind
 * config.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';

interface SidebarProps {
  tenant: AuthTenantDto;
  user: AuthUserDto;
}

interface NavItem {
  label: string;
  href: string | null;
  icon: LucideIcon;
  disabled?: boolean;
  /**
   * Match function. Defaults to exact path match. Some items (Motor Clubs is
   * just /accounts with a query string) need to read searchParams to
   * discriminate, so both are passed.
   */
  match?: (pathname: string, searchParams: URLSearchParams) => boolean;
  /**
   * Per-item brand accent (hex). Overrides the orange default for active
   * state — used by the ECOSYSTEM tabs so each Blue Collar AI sibling
   * product reads as its own thing in the nav.
   */
  accentColor?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    // Vehicles is intentionally NOT a top-level nav item. Vehicles are a
    // work object captured during call intake (Session 4) or via the inline
    // editor on the customer detail page. The /vehicles/[id] detail route
    // still exists for deep-link editing, but there's no list view.
    label: 'Operations',
    items: [
      {
        label: 'Intake',
        href: '/intake',
        icon: PhoneCall,
        match: (p) => p.startsWith('/intake'),
      },
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      {
        label: 'Tow Jobs',
        href: '/jobs',
        icon: Truck,
        match: (p) => p.startsWith('/jobs'),
      },
      {
        label: 'Live Dispatch',
        href: '/dispatch',
        icon: Radio,
        match: (p) => p.startsWith('/dispatch'),
      },
      {
        label: 'Fleet',
        href: '/fleet',
        icon: CarFront,
        match: (p) => p.startsWith('/fleet'),
      },
      {
        label: 'Drivers',
        href: '/fleet/drivers',
        icon: Users,
        match: (p) => p.startsWith('/fleet/drivers'),
      },
    ],
  },
  {
    label: 'Customers',
    items: [
      {
        label: 'Customers',
        href: '/customers',
        icon: Building2,
        match: (p) => p.startsWith('/customers'),
      },
      {
        label: 'Accounts',
        href: '/accounts',
        icon: Building2,
        // Plain /accounts path. Motor Clubs is /accounts?type=motor_club — let
        // that item own the highlight when the type filter is set.
        match: (p, sp) =>
          (p === '/accounts' && sp.get('type') !== 'motor_club') || p.startsWith('/accounts/'),
      },
      {
        label: 'Billing',
        href: '/billing/invoices',
        icon: Receipt,
        match: (p) => p.startsWith('/billing'),
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        label: 'Accounting',
        href: '/accounting/settings',
        icon: Calculator,
        match: (p) => p.startsWith('/accounting'),
      },
    ],
  },
  {
    label: 'Integrations',
    items: [
      {
        label: 'Motor Clubs',
        href: '/accounts?type=motor_club',
        icon: ShieldCheck,
        match: (p, sp) => p === '/accounts' && sp.get('type') === 'motor_club',
      },
      { label: 'Email Settings', href: null, icon: Mail, disabled: true },
    ],
  },
  {
    // ECOSYSTEM — Blue Collar AI sibling products surfaced as branded entry
    // points. These pages are placeholders until each product ships its own
    // integration; today they explain what the product is and why it sits
    // next to US Tow DISPATCH.
    label: 'Ecosystem',
    items: [
      {
        label: 'CONVINI',
        href: '/ecosystem/convini',
        icon: Sparkles,
        accentColor: '#0F9D58',
        match: (p) => p.startsWith('/ecosystem/convini'),
      },
      {
        label: 'FleetCommand',
        href: '/ecosystem/fleetcommand',
        icon: Navigation,
        accentColor: '#1E88E5',
        match: (p) => p.startsWith('/ecosystem/fleetcommand'),
      },
      {
        label: 'FleetGuard Pro',
        href: '/ecosystem/fleetguard',
        icon: ShieldCheck,
        accentColor: '#F59E0B',
        match: (p) => p.startsWith('/ecosystem/fleetguard'),
      },
    ],
  },
];

export function AppSidebar({ tenant, user }: SidebarProps): JSX.Element {
  const pathname = usePathname() ?? '/';
  // useSearchParams() returns ReadonlyURLSearchParams; fall back to an empty
  // params object during edge cases where Next returns null (initial render
  // boundary). Matchers that don't read sp ignore this entirely.
  const searchParams = useSearchParams() ?? new URLSearchParams();
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-divider bg-bg-surface md:flex">
      <div className="flex items-center gap-3 border-b border-divider px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-primary ">
          <span className="font-condensed text-xs font-extrabold tracking-tight text-white">
            UTD
          </span>
        </div>
        <span className="font-condensed text-base leading-none tracking-tight">
          <span className="font-medium">
            US <span className="text-brand-primary">Tow</span>{' '}
          </span>
          <span className="font-extrabold italic uppercase">Dispatch</span>
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-text-secondary-on-dark-on-dark/60">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  item.href !== null &&
                  (item.match ? item.match(pathname, searchParams) : pathname === item.href);
                const content = (
                  <span className="flex items-center gap-3">
                    <item.icon className="h-4 w-4" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </span>
                );
                if (item.href && !item.disabled) {
                  const accent = item.accentColor;
                  if (accent) {
                    // ECOSYSTEM tab. `${hex}14` = ~8% alpha (active bg),
                    // `${hex}0A` = ~4% alpha (hover bg). The Tailwind
                    // arbitrary-value classes below read these via var().
                    const accentVars = {
                      '--accent': accent,
                      '--accent-bg-active': `${accent}14`,
                      '--accent-bg-hover': `${accent}0A`,
                    } as CSSProperties;
                    return (
                      <li key={item.label}>
                        <Link
                          href={item.href}
                          style={accentVars}
                          className={cn(
                            'group relative flex items-center justify-between rounded-[8px] px-3 py-2 transition-colors',
                            isActive
                              ? 'bg-[var(--accent-bg-active)] text-[var(--accent)]'
                              : 'text-text-secondary-on-dark hover:bg-[var(--accent-bg-hover)]',
                          )}
                        >
                          {isActive ? (
                            <span
                              aria-hidden
                              style={{ backgroundColor: accent }}
                              className="absolute -left-3 top-1.5 h-6 w-[3px] rounded-r-full"
                            />
                          ) : null}
                          <span className="flex items-center gap-3">
                            <item.icon className="h-4 w-4" style={{ color: accent }} />
                            <span className="text-sm font-medium">{item.label}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  }
                  return (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        className={cn(
                          'group relative flex items-center justify-between rounded-[8px] px-3 py-2 transition-colors',
                          isActive
                            ? 'bg-brand-primary/15 text-brand-primary'
                            : 'text-text-secondary-on-dark hover:bg-bg-surface-elevated hover:text-text-primary-on-dark',
                        )}
                      >
                        {isActive ? (
                          <span
                            aria-hidden
                            className="absolute -left-3 top-1.5 h-6 w-1 rounded-r-full bg-brand-primary"
                          />
                        ) : null}
                        {content}
                      </Link>
                    </li>
                  );
                }
                return (
                  <li
                    key={item.label}
                    className="flex cursor-not-allowed items-center justify-between rounded-[8px] px-3 py-2 text-text-secondary-on-dark-on-dark/60"
                    title="Coming soon"
                  >
                    {content}
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
                      Soon
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-divider px-3 py-3">
        <ul className="space-y-0.5">
          <li>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-text-secondary-on-dark transition-colors hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
            >
              <Settings className="h-4 w-4" />
              <span className="font-medium">Settings</span>
            </button>
          </li>
          <li>
            <a
              href="/logout"
              className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-text-secondary-on-dark transition-colors hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
            >
              <LogOut className="h-4 w-4" />
              <span className="font-medium">Sign out</span>
            </a>
          </li>
        </ul>
        <div className="mt-3 flex items-center gap-3 rounded-[8px] border border-divider bg-bg-surface-elevated/40 px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md  text-xs font-extrabold text-brand-primary">
            {tenant.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-primary-on-dark">
              {tenant.name}
            </p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
              {user.role}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
