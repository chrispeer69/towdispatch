import { ManualInvoiceFormClient } from './manual-invoice-form';

export const metadata = { title: 'New invoice — US Tow DISPATCH' };

export default function NewInvoicePage(): JSX.Element {
  return (
    <div className="space-y-4">
      <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
        New manual invoice
      </h1>
      <ManualInvoiceFormClient />
    </div>
  );
}
