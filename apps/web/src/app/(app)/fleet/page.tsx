import { tracedRedirect } from '@/lib/debug/redirect-trace';

export default function FleetIndexPage(): never {
  tracedRedirect('/fleet/trucks', 'fleet-index-page:hardcoded');
}
