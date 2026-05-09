import { AccountForm } from '../account-form';

export const metadata = { title: 'New account — TowCommand' };

export default function NewAccountPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          New account
        </h1>
        <p className="text-sm text-text-secondary">
          Commercial billing relationship — fleet, motor club, or anyone you invoice.
        </p>
      </header>
      <AccountForm mode="create" />
    </div>
  );
}
