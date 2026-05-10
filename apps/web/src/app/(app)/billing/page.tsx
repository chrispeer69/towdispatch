import { redirect } from 'next/navigation';

export default function BillingIndexPage(): never {
  redirect('/billing/invoices');
}
