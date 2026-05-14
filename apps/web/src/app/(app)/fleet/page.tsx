import { redirect } from 'next/navigation';

export default function FleetIndexPage(): never {
  redirect('/fleet/trucks');
}
