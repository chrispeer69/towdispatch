import { CustomerForm } from '../customer-form';

export const metadata = { title: 'New customer — TowCommand' };

export default function NewCustomerPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          New customer
        </h1>
        <p className="text-sm text-text-secondary">
          Identity, contact, and billing details for the person or business you serve.
        </p>
      </header>
      <CustomerForm mode="create" />
    </div>
  );
}
