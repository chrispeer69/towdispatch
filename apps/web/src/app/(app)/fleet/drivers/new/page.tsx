import { DriverForm } from '../driver-form';

export default function NewDriverPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl">
      <DriverForm mode="create" />
    </div>
  );
}
