'use client';

import { cn } from '@/lib/utils';
import type { AuthTenantDto, AuthUserDto } from '@ustowdispatch/shared';
import {
  BarChart3,
  Blocks,
  Building2,
  Calculator,
  CarFront,
  Gavel,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Mail,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  Plug,
  Radio,
  Receipt,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Truck,
  Warehouse,
  Wrench,
  Zap,
} from 'lucide-react';
/**
 * 240px-wide left sidebar. Pulls the active path from `usePathname()` so the
 * matching pill highlights when on that route. Email Settings points at the
 * Notifications tab inside /settings, which is the canonical home for the
 * email + notifications surface (read-only inventory today; per-tenant
 * config is follow-up work).
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
import { type CSSProperties, useEffect, useState } from 'react';

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
        // Session 41 — AI Smart Dispatch. Advisory candidate scoring +
        // predictive-ETA accuracy reports. The page gates by role; the link
        // is shown to all and the page surfaces a friendly denied state.
        label: 'AI Dispatch',
        href: '/ai-dispatch',
        icon: Sparkles,
        match: (p) => p.startsWith('/ai-dispatch'),
      },
      {
        label: 'Assign Jobs',
        href: '/assign-jobs',
        icon: Truck,
        match: (p) => p.startsWith('/assign-jobs'),
      },
      {
        // Renamed from "Fleet" → "TRUCKS/DRIVERS" at user request; the
        // route stays at /fleet so deep links and the /fleet/* sub-pages
        // keep working. The standalone Drivers entry was removed at the
        // same time — this combined label subsumes it. /fleet/drivers
        // is still reachable by direct URL and via fleet workflows.
        label: 'Trucks/Drivers',
        href: '/fleet',
        icon: CarFront,
        match: (p) => p.startsWith('/fleet'),
      },
      {
        // Session 36 — Heavy-Duty Specialist. Class 7/8 + commercial
        // recovery: truck capabilities, driver certs, HD job intake +
        // eligibility, rate sheets, and HD reports. Page surfaces a
        // friendly access-denied state for roles the API gates out.
        label: 'Heavy-Duty',
        href: '/heavy-duty',
        icon: Wrench,
        match: (p) => p.startsWith('/heavy-duty'),
      },
      {
        // Moat #1 — Dynamic Pricing Engine Control Panel. Top-level so
        // the operator can see active tiers, today's pulse, and recent
        // overrides at a glance. Configuration lives under
        // /settings/dynamic-pricing.
        label: 'Dynamic Pricing',
        href: '/dynamic-pricing',
        icon: Zap,
        match: (p) => p.startsWith('/dynamic-pricing'),
      },
      {
        // Moat #3 — Tier Offer Composer. The collective-bargaining tool:
        // operators compose pricing offers and send them to motor-club
        // account managers who accept or decline independently. Visible
        // to OWNER, ADMIN, MANAGER, ACCOUNTING, AUDITOR per the API
        // RBAC; we don't gate the link on role here because the page
        // itself surfaces a friendly access-denied state for roles that
        // can't view it (DISPATCHER + DRIVER).
        label: 'Tier Offers',
        href: '/tier-offers',
        icon: Mail,
        match: (p) => p.startsWith('/tier-offers'),
      },
      {
        // Lien Processing (Session 23) — statutory lien-sale workflow for
        // unclaimed impounded vehicles. The page gates access by role
        // (OWNER / ADMIN / DISPATCHER / AUDITOR) with a friendly 403, so the
        // link itself is unguarded here.
        label: 'Lien Cases',
        href: '/lien-cases',
        icon: Gavel,
        match: (p) => p.startsWith('/lien-cases'),
      },
      {
        // Repo Workflow (Session 49) — repossession assignments from
        // lienholders: locate → attempt → recover → close, plus the
        // lienholder book and recovery-fee invoicing. The page gates access
        // by role with a friendly 403, so the link is unguarded here.
        label: 'Repo Cases',
        href: '/repo/cases',
        icon: Truck,
        match: (p) => p.startsWith('/repo'),
      },
      {
        // Full DOT Compliance (Session 37) — FMCSA recordkeeping: carrier
        // profile, driver qualifications, hours-of-service, drug & alcohol
        // program, incident register, and audit-packet PDF. The page gates
        // access by role with a friendly 403, so the link is unguarded here.
        label: 'DOT Compliance',
        href: '/dot',
        icon: ShieldCheck,
        match: (p) => p.startsWith('/dot'),
      },
      {
        // Yard Management (Session 54) — facilities, stall map, storage rate
        // cards, auto-billing, gate search, and the release workflow. The
        // pages gate access by role with a friendly 403, so the link is
        // unguarded here.
        label: 'Yard',
        href: '/yard/facilities',
        icon: Warehouse,
        match: (p) => p.startsWith('/yard'),
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
    label: 'Insights',
    items: [
      {
        label: 'Reports',
        href: '/reports',
        icon: BarChart3,
        match: (p) => p.startsWith('/reports'),
      },
      {
        // Fraud Detection (Session 43) — defensive analytics scoring job
        // fraud/dispute risk + a motor-club dispute log. The page gates
        // access by role (OWNER / ADMIN / DISPATCHER / AUDITOR) with a
        // friendly 403, so the link itself is unguarded here.
        label: 'Fraud Risk',
        href: '/fraud',
        icon: ShieldAlert,
        match: (p) => p.startsWith('/fraud'),
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
      {
        label: 'Email Settings',
        href: '/settings/notifications',
        icon: Mail,
        match: (p) => p.startsWith('/settings/notifications'),
      },
      {
        label: 'App Marketplace',
        href: '/marketplace',
        icon: Blocks,
        match: (p) => p.startsWith('/marketplace'),
      },
      {
        // Operator-managed third-party app connections (Session 46). The page
        // itself surfaces a friendly access-denied state for roles the API
        // gates out (OWNER/ADMIN only).
        label: 'Installed Apps',
        href: '/installed-apps',
        icon: Plug,
        match: (p) => p.startsWith('/installed-apps'),
      },
    ],
  },
  {
    // ECOSYSTEM — Blue Collar AI sibling products surfaced as branded entry
    // points. These pages are placeholders until each product ships its own
    // integration; today they explain what the product is and why it sits
    // next to US Tow Dispatch.
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
  // Auto-collapse the nav to a narrow icon rail on the Live Dispatch board so
  // the dense dispatch tiles + map get the full board width; auto-expand on
  // every other route. The manual toggle still works within a route until the
  // next navigation re-applies the route default. Lazy initial state matches
  // the route on first render so there's no expanded→collapsed flash on
  // /dispatch. Main content is `flex-1`, so shrinking this rail widens the board.
  const [collapsed, setCollapsed] = useState(() => pathname.startsWith('/dispatch'));
  useEffect(() => {
    setCollapsed(pathname.startsWith('/dispatch'));
  }, [pathname]);

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-divider bg-bg-surface transition-[width] duration-200 md:flex',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/*
        Brand mark navigates to the dashboard. The collapse toggle is a
        separate button so it never triggers navigation.
      */}
      <div
        className={cn(
          'flex border-b border-divider',
          collapsed ? 'flex-col items-center gap-2 px-2 py-3' : 'items-center gap-2 px-3 py-4',
        )}
      >
        <Link
          href="/dashboard"
          title="Dashboard"
          aria-label="Dashboard"
          className={cn(
            'flex items-center gap-3 rounded-lg transition-colors hover:bg-bg-surface-elevated/40',
            collapsed ? 'justify-center p-1' : 'min-w-0 flex-1 px-2 py-1',
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary">
            <span className="font-condensed text-xs font-extrabold tracking-tight text-white">
              UTD
            </span>
          </div>
          {!collapsed ? (
            <span className="truncate font-condensed text-base leading-none tracking-tight">
              <span className="font-medium">
                US <span className="text-brand-primary">Tow</span>{' '}
              </span>
              <span className="font-extrabold italic uppercase">Dispatch</span>
            </span>
          ) : null}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-text-secondary-on-dark transition-colors hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            {!collapsed ? (
              <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-text-secondary-on-dark-on-dark/60">
                {section.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  item.href !== null &&
                  (item.match ? item.match(pathname, searchParams) : pathname === item.href);
                const content = (
                  <span
                    className={cn('flex items-center gap-3', collapsed && 'justify-center gap-0')}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed ? <span className="text-sm font-medium">{item.label}</span> : null}
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
                          title={collapsed ? item.label : undefined}
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
                          <span
                            className={cn(
                              'flex items-center gap-3',
                              collapsed && 'justify-center gap-0',
                            )}
                          >
                            <item.icon className="h-4 w-4 shrink-0" style={{ color: accent }} />
                            {!collapsed ? (
                              <span className="text-sm font-medium">{item.label}</span>
                            ) : null}
                          </span>
                        </Link>
                      </li>
                    );
                  }
                  return (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
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
                    title={collapsed ? `${item.label} — coming soon` : 'Coming soon'}
                  >
                    {content}
                    {!collapsed ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
                        Soon
                      </span>
                    ) : null}
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
            {(() => {
              const settingsActive = pathname === '/settings' || pathname.startsWith('/settings/');
              return (
                <Link
                  href="/settings"
                  aria-current={settingsActive ? 'page' : undefined}
                  title={collapsed ? 'Settings' : undefined}
                  className={cn(
                    'group relative flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-sm transition-colors',
                    collapsed && 'justify-center gap-0',
                    settingsActive
                      ? 'bg-brand-primary/15 text-brand-primary'
                      : 'text-text-secondary-on-dark hover:bg-bg-surface-elevated hover:text-text-primary-on-dark',
                  )}
                >
                  {settingsActive ? (
                    <span
                      aria-hidden
                      className="absolute -left-3 top-1.5 h-6 w-1 rounded-r-full bg-brand-primary"
                    />
                  ) : null}
                  <Settings className="h-4 w-4 shrink-0" />
                  {!collapsed ? <span className="font-medium">Settings</span> : null}
                </Link>
              );
            })()}
          </li>
          <li>
            <a
              href="/logout"
              title={collapsed ? 'Sign out' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-text-secondary-on-dark transition-colors hover:bg-bg-surface-elevated hover:text-text-primary-on-dark',
                collapsed && 'justify-center gap-0',
              )}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!collapsed ? <span className="font-medium">Sign out</span> : null}
            </a>
          </li>
        </ul>
        <div
          className={cn(
            'mt-3 flex items-center gap-3 rounded-[8px] border border-divider bg-bg-surface-elevated/40 px-3 py-2',
            collapsed && 'justify-center px-0',
          )}
          title={collapsed ? `${tenant.name} — ${user.role}` : undefined}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-extrabold text-brand-primary">
            {tenant.name.charAt(0).toUpperCase()}
          </div>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text-primary-on-dark">
                {tenant.name}
              </p>
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
                {user.role}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
