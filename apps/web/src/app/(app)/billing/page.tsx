import { tracedRedirect } from '@/lib/debug/redirect-trace';

export default function BillingIndexPage(): never {
  tracedRedirect('/billing/invoices', 'billing-index-page:hardcoded');
}
