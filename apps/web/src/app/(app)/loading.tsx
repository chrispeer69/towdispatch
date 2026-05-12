/**
 * Default loading state for the authenticated shell. Next.js streams this
 * during a route transition before the page resolves. Renders a generic
 * skeleton table — every list page in the app fits this shape, and
 * per-page loading.tsx files can override with more specific skeletons.
 */
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton';

export default function AppLoading(): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonTable rows={8} columns={5} caption="Loading page content" />
    </div>
  );
}
