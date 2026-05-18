import { redirect } from 'next/navigation';

/**
 * /driver redirects to /driver/workspace. If the user isn't signed in
 * the auth gate intercepts and sends them to /driver/login.
 */
export default function DriverRoot(): never {
  redirect('/driver/workspace');
}
