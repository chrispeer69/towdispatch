import { apiServerSafe } from '@/lib/api/client';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { OnboardingStateDto } from './types';
import { OnboardingWizard } from './wizard';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Set up your workspace · US Tow Dispatch',
};

/**
 * Authenticated onboarding wizard. Lives under /signup so it stays within the
 * session's allowed web scope; it is NOT a public page — it reads the session
 * cookie set by the signup BFF and bounces to /login if absent. The first load
 * lazily creates the onboarding_progress row server-side. The access token is
 * read here at the page level and passed through explicitly (see
 * RequestOpts.accessToken in lib/api/client.ts).
 */
export default async function OnboardingWizardPage(): Promise<JSX.Element> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
  if (!token) redirect('/login?next=/signup/wizard');

  const res = await apiServerSafe<OnboardingStateDto>('/onboarding/progress', {
    accessToken: token,
  });
  if (res.error) {
    if (res.error.status === 401 || res.error.status === 403) {
      redirect('/login?next=/signup/wizard');
    }
    throw res.error;
  }

  return <OnboardingWizard initialState={res.data} />;
}
