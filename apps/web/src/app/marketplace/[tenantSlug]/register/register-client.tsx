'use client';
import { bidderRegister } from '@/lib/api/marketplace-client';
import Link from 'next/link';
import { type FormEvent, type JSX, useState } from 'react';

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';

export function RegisterClient({ slug }: { slug: string }): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/marketplace/${encodeURIComponent(slug)}`;

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await bidderRegister({
        tenantSlug: slug,
        name: name.trim(),
        email: email.trim(),
        password,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(businessName.trim() ? { businessName: businessName.trim() } : {}),
        ...(licenseNo.trim() ? { licenseNo: licenseNo.trim() } : {}),
      });
      setDone('Check your email to confirm your account, then sign in.');
      setDevToken(res.devVerificationToken);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="max-w-sm mx-auto">
        <h1 className="text-2xl font-bold tracking-tight mb-3">Almost there</h1>
        <p className="text-sm text-text-secondary-on-dark">{done}</p>
        {devToken && (
          <p className="mt-4 text-sm">
            <span className="text-text-secondary-on-dark">Dev shortcut: </span>
            <Link
              href={`${base}/verify?token=${encodeURIComponent(devToken)}`}
              className="text-accent-orange font-semibold break-all"
            >
              Verify now
            </Link>
          </p>
        )}
        <p className="mt-4 text-sm">
          <Link href={`${base}/login`} className="text-accent-orange font-semibold">
            Back to sign in
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-sm mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Create a bidder account</h1>
      {error && (
        <p className="mb-4 rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
          {error}
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <input
          className={inputCls}
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={inputCls}
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <input
          className={inputCls}
          type="password"
          placeholder="Password (10+ chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <input
          className={inputCls}
          placeholder="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Business name (optional)"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Dealer license # (optional)"
          value={licenseNo}
          onChange={(e) => setLicenseNo(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2.5 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Register'}
        </button>
      </form>
    </section>
  );
}
