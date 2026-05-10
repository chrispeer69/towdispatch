'use client';

import { cn } from '@/lib/utils';
import type { AuthTenantDto, AuthUserDto } from '@towcommand/shared';
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
 * matching pill highlights when on that route. Disabled items (jobs, drivers,
 * fleet, invoices, accounting, email settings) are visually present but not
 * navigable until their respective sessions ship.
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
import { usePathname } from 'next/navigation';
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
   * Match function. Defaults to exact match. Some items (Motor Clubs is just
   * /accounts with a query string) need a custom matcher so the highlight
   * stays accurate.
   */
  match?: (pathname: string) => boolean;
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
      { label: 'Tow Jobs', href: null, icon: Truck, disabled: true },
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
      { label: 'Drivers', href: null, icon: Users, disabled: true },
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
        // Plain /accounts path. Motor Clubs filters via /accounts?type=motor_club.
        match: (p) => p === '/accounts' || p.startsWith('/accounts/'),
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
    items: [{ label: 'Accounting', href: null, icon: Calculator, disabled: true }],
  },
  {
    label: 'Integrations',
    items: [
      {
        label: 'Motor Clubs',
        href: '/accounts?type=motor_club',
        icon: ShieldCheck,
      },
      { label: 'Email Settings', href: null, icon: Mail, disabled: true },
    ],
  },
  {
    // ECOSYSTEM — Blue Collar AI sibling products surfaced as branded entry
    // points. These pages are placeholders until each product ships its own
    // integration; today they explain what the product is and why it sits
    // next to TowCommand.
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
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-steel-border bg-steel-mid md:flex">
      <div className="flex items-center gap-3 border-b border-steel-border px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange shadow-orange-glow">
          <span className="font-condensed text-lg font-extrabold text-white">T</span>
        </div>
        <span className="font-condensed text-base font-extrabold uppercase tracking-wide">
          Tow<span className="text-orange">Command</span>
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  item.href !== null &&
                  (item.match ? item.match(pathname) : pathname === item.href);
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
                              : 'text-text-secondary hover:bg-[var(--accent-bg-hover)]',
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
                            ? 'bg-orange/15 text-orange-light'
                            : 'text-text-secondary hover:bg-steel-light hover:text-text-primary',
                        )}
                      >
                        {isActive ? (
                          <span
                            aria-hidden
                            className="absolute -left-3 top-1.5 h-6 w-1 rounded-r-full bg-orange"
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
                    className="flex cursor-not-allowed items-center justify-between rounded-[8px] px-3 py-2 text-text-muted"
                    title="Coming soon"
                  >
                    {content}
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                      Soon
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-steel-border px-3 py-3">
        <ul className="space-y-0.5">
          <li>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-steel-light hover:text-text-primary"
            >
              <Settings className="h-4 w-4" />
              <span className="font-medium">Settings</span>
            </button>
          </li>
          <li>
            <Link
              href="/logout"
              className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-steel-light hover:text-text-primary"
            >
              <LogOut className="h-4 w-4" />
              <span className="font-medium">Sign out</span>
            </Link>
          </li>
        </ul>
        <div className="mt-3 flex items-center gap-3 rounded-[8px] border border-steel-border bg-steel-light/40 px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-glow text-xs font-extrabold text-orange-light">
            {tenant.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-primary">{tenant.name}</p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
              {user.role}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
