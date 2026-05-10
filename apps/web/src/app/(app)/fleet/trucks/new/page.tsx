import { TruckForm } from '../truck-form';

export default function NewTruckPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl">
      <TruckForm mode="create" />
    </div>
  );
}
