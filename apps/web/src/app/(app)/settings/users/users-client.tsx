'use client';

/**
 * /settings/users — live user + permissions admin.
 *
 * Capabilities (against the existing /users CRUD endpoints):
 *   - List every user in the caller's tenant
 *   - Add a new user (OWNER/ADMIN — modal with email, name, password,
 *     phone, role)
 *   - Change a user's role inline (OWNER/ADMIN/MANAGER)
 *   - Deactivate a user (OWNER/ADMIN — soft-delete)
 *
 * Not yet implemented (each is a discrete follow-up):
 *   - Invite-by-email (backend doesn't model invite tokens — POST
 *     /users requires the admin to set a password today).
 *   - Re-activating a soft-deleted user.
 *   - Admin-side MFA status / enrolment view (mfaEnabled isn't on
 *     UserDto today).
 *   - Granular permissions beyond the 7 built-in roles.
 *
 * Modal uses a native <dialog> element opened via showModal() so the
 * browser supplies the focus trap, Escape-to-close, and backdrop
 * scrim — no custom keyboard / a11y plumbing needed.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ROLE_VALUES, type Role, type UserDto } from '@towdispatch/shared';
import { Loader2, Lock, Trash2, UserPlus, X } from 'lucide-react';
import { type FormEvent, type JSX, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  initial: UserDto[];
}

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
  accounting: 'Accounting',
  auditor: 'Auditor',
};

const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: 'Full access. Cannot be deactivated except by another Owner.',
  admin: 'Full access except billing ownership transfer.',
  manager: 'Operations + reporting. Can edit users below Admin.',
  dispatcher: 'Intake, dispatch, and job lifecycle. No billing edits.',
  driver: 'Mobile-only. Drivers see assigned jobs and DVIR.',
  accounting: 'Billing, invoices, payments, statements.',
  auditor: 'Read-only across the platform.',
};

export function UsersClient({ initial }: Props): JSX.Element {
  const [users, setUsers] = useState<UserDto[]>(initial);
  const [createOpen, setCreateOpen] = useState(false);

  function upsertUser(updated: UserDto): void {
    setUsers((prev) => {
      const i = prev.findIndex((u) => u.id === updated.id);
      if (i === -1) return [...prev, updated];
      const next = prev.slice();
      next[i] = updated;
      return next;
    });
  }

  function removeUser(id: string): void {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary-on-dark">
          {users.length} {users.length === 1 ? 'user' : 'users'} in this tenant
        </p>
        <Button onClick={() => setCreateOpen(true)} type="button">
          <UserPlus className="mr-2 h-4 w-4" />
          Add user
        </Button>
      </div>

      <section className="overflow-hidden rounded-[14px] border border-divider">
        <table className="w-full divide-y divide-divider text-sm">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>MFA</Th>
              <Th>Last login</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {users.map((u) => (
              <UserRow key={u.id} user={u} onUpdate={upsertUser} onDeactivate={removeUser} />
            ))}
            {users.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm text-text-secondary-on-dark"
                >
                  No users in this tenant yet. Click <strong>Add user</strong> to invite the first
                  one.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {createOpen ? (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={(u) => {
            upsertUser(u);
            setCreateOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function UserRow({
  user,
  onUpdate,
  onDeactivate,
}: {
  user: UserDto;
  onUpdate: (u: UserDto) => void;
  onDeactivate: (id: string) => void;
}): JSX.Element {
  const [savingRole, setSavingRole] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [permissionLocked, setPermissionLocked] = useState(false);

  async function changeRole(newRole: Role): Promise<void> {
    if (newRole === user.role) return;
    setSavingRole(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setPermissionLocked(true);
          toast.error('You don’t have permission to change this user’s role.');
          return;
        }
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      const updated = (await res.json()) as UserDto;
      onUpdate(updated);
      toast.success(`${updated.firstName}'s role updated to ${ROLE_LABEL[updated.role]}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingRole(false);
    }
  }

  async function deactivate(): Promise<void> {
    if (
      !window.confirm(
        `Deactivate ${user.firstName} ${user.lastName}? They will lose access to the workspace.`,
      )
    ) {
      return;
    }
    setDeactivating(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        if (res.status === 401 || res.status === 403) {
          setPermissionLocked(true);
          toast.error('You don’t have permission to deactivate users.');
          return;
        }
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? `Deactivate failed (HTTP ${res.status})`);
        return;
      }
      onDeactivate(user.id);
      toast.success(`${user.firstName} ${user.lastName} deactivated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Deactivate failed');
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <tr className="hover:bg-bg-surface-elevated/30">
      <td className="px-4 py-3 align-middle">
        <div className="font-medium text-text-primary-on-dark">
          {user.firstName} {user.lastName}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
          {user.id.slice(0, 8)}
        </div>
      </td>
      <td className="px-4 py-3 align-middle text-text-secondary-on-dark">
        {user.email}
        {user.emailVerifiedAt ? null : (
          <span className="ml-2 rounded bg-status-warning/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-status-warning">
            Unverified
          </span>
        )}
      </td>
      <td className="px-4 py-3 align-middle">
        <select
          value={user.role}
          disabled={savingRole || permissionLocked}
          onChange={(e) => changeRole(e.target.value as Role)}
          className={cn(
            'rounded-md border border-divider bg-bg-surface px-2 py-1 text-sm text-text-primary-on-dark transition-colors',
            'focus:outline-none focus:ring-1 focus:ring-brand-primary/40 focus:border-brand-primary/60',
            savingRole || permissionLocked ? 'opacity-50' : 'hover:border-divider-strong',
          )}
          title={ROLE_DESCRIPTION[user.role]}
        >
          {ROLE_VALUES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        {savingRole ? (
          <Loader2 className="ml-1 inline h-3 w-3 animate-spin text-text-secondary-on-dark" />
        ) : null}
      </td>
      <td className="px-4 py-3 align-middle">
        <span className="rounded bg-bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
          {user.emailVerifiedAt ? 'User-managed' : '—'}
        </span>
      </td>
      <td className="px-4 py-3 align-middle text-text-secondary-on-dark">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : '—'}
      </td>
      <td className="px-4 py-3 align-middle text-right">
        <button
          type="button"
          onClick={deactivate}
          disabled={deactivating || permissionLocked}
          className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-semibold text-danger transition-colors hover:border-danger/60 disabled:opacity-40"
          title={
            permissionLocked
              ? 'You don’t have permission to deactivate users'
              : `Deactivate ${user.firstName} ${user.lastName}`
          }
        >
          {permissionLocked ? <Lock className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
          {deactivating ? 'Deactivating…' : 'Deactivate'}
        </button>
      </td>
    </tr>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (u: UserDto) => void;
}): JSX.Element {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('dispatcher');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Native <dialog> handles focus trap, Escape-to-close, backdrop
  // scrim. Open imperatively so the modal scrim renders.
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        role,
      };
      if (phone.trim()) payload.phone = phone.trim();
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          code?: string;
          message?: string;
          errors?: unknown;
        } | null;
        setErrorMessage(body?.message ?? `Create failed (HTTP ${res.status}).`);
        return;
      }
      const created = (await res.json()) as UserDto;
      toast.success(
        `${created.firstName} ${created.lastName} added as ${ROLE_LABEL[created.role]}.`,
      );
      onCreated(created);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="create-user-title"
      onClose={onClose}
      className="w-full max-w-md rounded-[14px] border border-divider bg-bg-surface p-0 text-text-primary-on-dark shadow-xl backdrop:bg-bg-base/60 backdrop:backdrop-blur"
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <h2 id="create-user-title" className="text-lg font-semibold text-text-primary-on-dark">
            Add a user
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-text-secondary-on-dark transition-colors hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          The user will sign in immediately with this email + password. Invite-by-email is a
          follow-up.
        </p>
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="new-first">First name</Label>
              <Input
                id="new-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-last">Last name</Label>
              <Input
                id="new-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                maxLength={120}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-phone">Phone (optional)</Label>
            <Input
              id="new-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={40}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-password">Temporary password</Label>
            <Input
              id="new-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="Min 12, upper + lower + digit"
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
              Share securely. User should rotate on first sign-in.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-role">Role</Label>
            <select
              id="new-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
            >
              {ROLE_VALUES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]} — {ROLE_DESCRIPTION[r]}
                </option>
              ))}
            </select>
          </div>

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {errorMessage}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary-on-dark hover:text-text-primary-on-dark"
            >
              Cancel
            </button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Add user'}
            </Button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}): JSX.Element {
  return (
    <th
      className={cn(
        'px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark',
        align === 'right' && 'text-right',
      )}
    >
      {children}
    </th>
  );
}
