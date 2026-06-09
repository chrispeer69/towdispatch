'use client';
/**
 * /driver/d/[code] — vanity URL for frictionless one-tap onboarding.
 *
 * The dispatcher texts or emails the driver a link like:
 *   https://app.ustowdispatch.cloud/driver/d/482917
 *
 * The driver taps it once on their phone. We persist the code, then
 * redirect to /driver/login?code=482917&step=picker. From that point
 * forward the device remembers the code and the driver only sees the
 * picker + PIN keypad on subsequent visits.
 *
 * Drivers should never be sent the URL slug — it leaks the operator's
 * internal naming and is harder to type on a phone.
 */
import { persistTenantCode } from '@/lib/driver/auth';
import { useRouter } from 'next/navigation';
import { use, useEffect } from 'react';

interface PageProps {
  params: Promise<{ code: string }>;
}

export default function DriverVanityCodePage({ params }: PageProps): JSX.Element {
  const router = useRouter();
  const { code } = use(params);

  useEffect(() => {
    if (!/^\d{6}$/.test(code)) {
      router.replace('/driver/login');
      return;
    }
    persistTenantCode(code);
    router.replace(`/driver/login?code=${encodeURIComponent(code)}&step=code`);
  }, [code, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base text-text-primary-on-dark">
      <p className="font-mono text-xs uppercase tracking-wider text-text-secondary-on-dark">
        Loading …
      </p>
    </div>
  );
}
