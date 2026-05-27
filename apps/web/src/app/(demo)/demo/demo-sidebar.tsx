'use client';

import { cn } from '@/lib/utils';
import {
  BarChart3,
  Building2,
  CarFront,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  PhoneCall,
  Radio,
  Sparkles,
  Truck,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
  id?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: 'Operations',
    items: [
      {
        label: 'Intake',
        href: '/demo/intake',
        icon: PhoneCall,
        match: (p) => p.startsWith('/demo/intake'),
      },
      {
        label: 'Dashboard',
        href: '/demo',
        icon: LayoutDashboard,
        match: (p) => p === '/demo',
      },
      {
        label: 'Tow Jobs',
        href: '/demo/jobs',
        icon: Truck,
        match: (p) => p.startsWith('/demo/jobs'),
      },
      {
        label: 'Live Dispatch',
        href: '/demo/dispatch',
        icon: Radio,
        match: (p) => p.startsWith('/demo/dispatch'),
        id: 'demo-sidebar-dispatch',
      },
      {
        label: 'AI Dispatch',
        href: '/demo',
        icon: Sparkles,
      },
      {
        label: 'Trucks/Drivers',
        href: '/demo',
        icon: CarFront,
      },
      {
        label: 'Dynamic Pricing',
        href: '/demo',
        icon: Zap,
      },
    ],
  },
  {
    label: 'Customers',
    items: [
      {
        label: 'Customers',
        href: '/demo/customers',
        icon: Building2,
        match: (p) => p.startsWith('/demo/customers'),
      },
    ],
  },
  {
    label: 'Insights',
    items: [
      {
        label: 'Reports',
        href: '/demo',
        icon: BarChart3,
      },
    ],
  },
];

export function DemoSidebar(): JSX.Element {
  const pathname = usePathname() ?? '/demo';

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-divider bg-bg-surface md:flex">
      {/* Brand + Demo badge */}
      <Link
        href="/demo"
        title="Demo Dashboard"
        aria-label="Demo Dashboard"
        className="flex items-center gap-3 border-b border-divider px-5 py-4 transition-colors hover:bg-bg-surface-elevated/40"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-primary">
          <span className="font-condensed text-xs font-extrabold tracking-tight text-white">
            UTD
          </span>
        </div>
        <div className="flex flex-col">
          <span className="font-condensed text-base leading-none tracking-tight">
            <span className="font-medium">
              US <span className="text-brand-primary">Tow</span>{' '}
            </span>
            <span className="font-extrabold italic uppercase">Dispatch</span>
          </span>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-primary/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-brand-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-primary animate-pulse" />
            Demo Mode
          </span>
        </div>
      </Link>

      <nav id="demo-sidebar-nav" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-text-secondary-on-dark/60">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = item.match ? item.match(pathname) : pathname === item.href;
                return (
                  <li key={item.label}>
                    <Link
                      id={item.id}
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
                      <span className="flex items-center gap-3">
                        <item.icon className="h-4 w-4" />
                        <span className="text-sm font-medium">{item.label}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-divider px-3 py-3">
        <ul className="space-y-0.5">
          <li>
            <Link
              href="/"
              className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-text-secondary-on-dark transition-colors hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
            >
              <LogOut className="h-4 w-4" />
              <span className="font-medium">Exit Demo</span>
            </Link>
          </li>
        </ul>
        <div className="mt-3 flex items-center gap-3 rounded-[8px] border border-divider bg-bg-surface-elevated/40 px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-extrabold text-brand-primary">
            A
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-primary-on-dark">
              Apex Towing & Recovery
            </p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
              OWNER
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
