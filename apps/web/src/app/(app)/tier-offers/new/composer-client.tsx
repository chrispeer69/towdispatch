'use client';
import {
  clientAddRecipient,
  clientCreateTierOffer,
  clientSendTierOffer,
} from '@/lib/api/tier-offers-client';
import type { DynamicPricingTierDto } from '@ustowdispatch/shared';
import { useRouter } from 'next/navigation';
/**
 * Composer client — the operator's bargaining table. Three-column
 * layout: form on the left, recipient picker in the middle, live
 * preview on the right.
 *
 * Conventions:
 *   - Local state only (no react-hook-form for v1; the form is small
 *     and the validation rules already live in shared zod schemas
 *     enforced at the API boundary).
 *   - Wording reinforces the negotiation framing — every label and
 *     error message treats the recipient as a partner the operator is
 *     bargaining with.
 *   - "Save draft" creates the offer and lands on the detail page.
 *   - "Send to recipients" creates the offer, adds each chip as a
 *     recipient, then POSTs /send. If anything fails partway through
 *     the operator still sees the resulting draft on the detail page
 *     and can retry from there.
 */
import { type JSX, useEffect, useMemo, useState } from 'react';

interface Props {
  tiers: DynamicPricingTierDto[];
  tenantName: string;
  senderName: string;
}

interface Recipient {
  /** Stable client-side id; the recipient row id assigned by the API
   *  arrives only after we POST it. */
  clientId: string;
  accountId: string | null;
  name: string;
  role: string | null;
  email: string;
}

interface AccountSearchResult {
  id: string;
  name: string;
  isMotorClub: boolean;
  active: boolean;
}

const NARRATIVE_SOFT_CAP = 2000;

function nowPlusHoursIso(hours: number): string {
  const d = new Date(Date.now() + hours * 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 16); // local "YYYY-MM-DDTHH:mm" for datetime-local
}

function localToIso(local: string): string {
  // Treat the datetime-local string as local time and convert to ISO.
  const d = new Date(local);
  return d.toISOString();
}

function newClientId(): string {
  return `c_${Math.random().toString(36).slice(2, 10)}`;
}

export function ComposerClient({ tiers, tenantName, senderName }: Props): JSX.Element {
  const router = useRouter();
  const activeTiers = useMemo(() => tiers.filter((t) => !t.deletedAt), [tiers]);
  const [tierId, setTierId] = useState<string>(activeTiers[0]?.id ?? '');
  const [title, setTitle] = useState<string>('');
  const [subjectLine, setSubjectLine] = useState<string>('');
  const [narrative, setNarrative] = useState<string>('');
  const [eventWindowStart, setEventWindowStart] = useState<string>(nowPlusHoursIso(12));
  const [eventWindowEnd, setEventWindowEnd] = useState<string>(nowPlusHoursIso(24));
  const [acceptanceDeadlineAt, setAcceptanceDeadlineAt] = useState<string>(nowPlusHoursIso(8));
  const [committedTruckCount, setCommittedTruckCount] = useState<string>('8');
  const [defaultForNonResponders, setDefaultForNonResponders] = useState<
    'opt_out' | 'accept_at_standard_rate'
  >('opt_out');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'sending'>('idle');
  const [error, setError] = useState<string | null>(null);

  function commonPayload(): Parameters<typeof clientCreateTierOffer>[0] {
    return {
      tierId,
      title: title.trim(),
      subjectLine: subjectLine.trim(),
      narrative: narrative.trim(),
      eventWindowStart: localToIso(eventWindowStart),
      eventWindowEnd: localToIso(eventWindowEnd),
      committedTruckCount: Math.max(1, Math.floor(Number(committedTruckCount) || 0)),
      acceptanceDeadlineAt: localToIso(acceptanceDeadlineAt),
      defaultForNonResponders,
    };
  }

  function validateLocal(): string | null {
    if (!tierId) return 'Pick a Dynamic Pricing tier.';
    if (title.trim().length < 1) return 'Add a title.';
    if (subjectLine.trim().length < 1) return 'Add an email subject line.';
    if (narrative.trim().length < 1) return 'Write the offer narrative.';
    if (recipients.length === 0)
      return 'Add at least one recipient before sending. (Drafts can be saved without recipients.)';
    if (new Date(eventWindowEnd) <= new Date(eventWindowStart))
      return 'Event window end must be after the start.';
    if (new Date(acceptanceDeadlineAt) > new Date(eventWindowStart))
      return 'Acceptance deadline must be at or before the event window start.';
    return null;
  }

  async function saveDraft(): Promise<void> {
    setError(null);
    if (
      !tierId ||
      title.trim().length < 1 ||
      subjectLine.trim().length < 1 ||
      narrative.trim().length < 1
    ) {
      setError('Title, subject line, narrative, and tier are required.');
      return;
    }
    setPhase('saving');
    try {
      const offer = await clientCreateTierOffer(commonPayload());
      // Recipients on a draft are optional — but if the operator added
      // any chips before clicking Save, persist them so the detail page
      // shows the roster.
      for (const r of recipients) {
        await clientAddRecipient(offer.id, {
          offerId: offer.id,
          accountId: r.accountId ?? undefined,
          recipientName: r.name,
          recipientRole: r.role ?? undefined,
          recipientEmail: r.email,
        });
      }
      router.push(`/tier-offers/${offer.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save draft.');
      setPhase('idle');
    }
  }

  async function sendNow(): Promise<void> {
    setError(null);
    const validationError = validateLocal();
    if (validationError) {
      setError(validationError);
      return;
    }
    setPhase('sending');
    try {
      const offer = await clientCreateTierOffer(commonPayload());
      for (const r of recipients) {
        await clientAddRecipient(offer.id, {
          offerId: offer.id,
          accountId: r.accountId ?? undefined,
          recipientName: r.name,
          recipientRole: r.role ?? undefined,
          recipientEmail: r.email,
        });
      }
      await clientSendTierOffer(offer.id);
      router.push(`/tier-offers/${offer.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send offer.');
      setPhase('idle');
    }
  }

  function addRecipient(r: Omit<Recipient, 'clientId'>): void {
    if (!r.email.trim()) return;
    setRecipients((prev) => {
      // Dedup on email (case-insensitive).
      const lower = r.email.trim().toLowerCase();
      if (prev.some((p) => p.email.trim().toLowerCase() === lower)) return prev;
      return [...prev, { ...r, clientId: newClientId() }];
    });
  }

  function removeRecipient(clientId: string): void {
    setRecipients((prev) => prev.filter((p) => p.clientId !== clientId));
  }

  const tier = activeTiers.find((t) => t.id === tierId) ?? null;

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Compose tier offer</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Propose terms to motor-club account managers. They accept or decline independently; the
            resulting allocation is contractually clean and audit-trailed.
          </p>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-status-danger-on-dark/40 bg-status-danger-on-dark/10 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — form */}
        <div className="space-y-4 lg:col-span-1">
          <fieldset className="bg-bg-surface-elevated border border-border-on-dark rounded-md p-4 space-y-3">
            <legend className="px-2 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Terms
            </legend>
            <div>
              <label htmlFor="tof-title" className="block text-xs font-semibold mb-1">
                Title
              </label>
              <input
                id="tof-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="Level-2 snow event 2026-12-21"
                className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="tof-subject" className="block text-xs font-semibold mb-1">
                Email subject
              </label>
              <input
                id="tof-subject"
                type="text"
                value={subjectLine}
                onChange={(e) => setSubjectLine(e.target.value)}
                maxLength={200}
                placeholder="Capacity offer — Level-2 snow event Dec 21"
                className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="tof-narrative" className="block text-xs font-semibold mb-1">
                Narrative
              </label>
              <textarea
                id="tof-narrative"
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                rows={6}
                maxLength={NARRATIVE_SOFT_CAP * 5}
                placeholder="We are committing 8 trucks during the Level-2 snow event…"
                className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
              />
              <div className="text-[11px] text-text-secondary-on-dark mt-1">
                {narrative.length}/{NARRATIVE_SOFT_CAP} characters{' '}
                {narrative.length > NARRATIVE_SOFT_CAP && '(longer than recommended)'}
              </div>
            </div>
            <div>
              <label htmlFor="tof-tier" className="block text-xs font-semibold mb-1">
                Dynamic Pricing tier
              </label>
              <select
                id="tof-tier"
                value={tierId}
                onChange={(e) => setTierId(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
              >
                <option value="">— Pick a tier —</option>
                {activeTiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({Number(t.multiplier).toFixed(2)}× — {t.category.replace('_', ' ')})
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          <fieldset className="bg-bg-surface-elevated border border-border-on-dark rounded-md p-4 space-y-3">
            <legend className="px-2 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Window
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="tof-window-start" className="block text-xs font-semibold mb-1">
                  Window start
                </label>
                <input
                  id="tof-window-start"
                  type="datetime-local"
                  value={eventWindowStart}
                  onChange={(e) => setEventWindowStart(e.target.value)}
                  className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="tof-window-end" className="block text-xs font-semibold mb-1">
                  Window end
                </label>
                <input
                  id="tof-window-end"
                  type="datetime-local"
                  value={eventWindowEnd}
                  onChange={(e) => setEventWindowEnd(e.target.value)}
                  className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="tof-deadline" className="block text-xs font-semibold mb-1">
                Acceptance deadline
              </label>
              <input
                id="tof-deadline"
                type="datetime-local"
                value={acceptanceDeadlineAt}
                onChange={(e) => setAcceptanceDeadlineAt(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="tof-trucks" className="block text-xs font-semibold mb-1">
                Trucks committed
              </label>
              <input
                id="tof-trucks"
                type="number"
                min={1}
                value={committedTruckCount}
                onChange={(e) => setCommittedTruckCount(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="tof-default" className="block text-xs font-semibold mb-1">
                If a club doesn&rsquo;t respond
              </label>
              <select
                id="tof-default"
                value={defaultForNonResponders}
                onChange={(e) =>
                  setDefaultForNonResponders(e.target.value as typeof defaultForNonResponders)
                }
                className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
              >
                <option value="opt_out">Opt out — no premium dispatches accepted</option>
                <option value="accept_at_standard_rate">
                  Accept dispatches at the standard rate
                </option>
              </select>
            </div>
          </fieldset>
        </div>

        {/* CENTER — recipient picker */}
        <div className="space-y-3 lg:col-span-1">
          <RecipientPicker
            recipients={recipients}
            onAdd={addRecipient}
            onRemove={removeRecipient}
          />
        </div>

        {/* RIGHT — preview */}
        <div className="space-y-3 lg:col-span-1">
          <Preview
            tenantName={tenantName}
            senderName={senderName}
            title={title}
            subjectLine={subjectLine}
            narrative={narrative}
            tierLabel={tier ? `${tier.name} (${Number(tier.multiplier).toFixed(2)}×)` : '—'}
            committedTruckCount={Number(committedTruckCount) || 0}
            eventWindowStart={eventWindowStart}
            eventWindowEnd={eventWindowEnd}
            acceptanceDeadlineAt={acceptanceDeadlineAt}
            defaultForNonResponders={defaultForNonResponders}
            recipientCount={recipients.length}
          />
        </div>
      </div>

      <footer className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveDraft}
          disabled={phase !== 'idle'}
          className="px-4 py-2 rounded-md border border-border-on-dark text-text-primary-on-dark disabled:opacity-50"
        >
          {phase === 'saving' ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={sendNow}
          disabled={phase !== 'idle'}
          className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-50"
        >
          {phase === 'sending' ? 'Sending…' : 'Send to recipients'}
        </button>
        <span className="text-xs text-text-secondary-on-dark">
          Recipients see emails immediately. Drafts can be edited or deleted.
        </span>
      </footer>
    </section>
  );
}

// =====================================================================
// Recipient picker
// =====================================================================
function RecipientPicker({
  recipients,
  onAdd,
  onRemove,
}: {
  recipients: Recipient[];
  onAdd: (r: Omit<Recipient, 'clientId'>) => void;
  onRemove: (clientId: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<AccountSearchResult[]>([]);
  const [searching, setSearching] = useState<boolean>(false);
  const [adhocName, setAdhocName] = useState<string>('');
  const [adhocRole, setAdhocRole] = useState<string>('');
  const [adhocEmail, setAdhocEmail] = useState<string>('');

  // 300ms debounce on the typeahead.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/accounts/search?q=${encodeURIComponent(trimmed)}&limit=8`);
        if (res.ok) {
          const json = (await res.json()) as AccountSearchResult[];
          // Motor-club accounts surface first; the API doesn't filter
          // server-side because the search is general-purpose.
          setResults(
            json
              .filter((a) => a.active)
              .sort((a, b) => Number(b.isMotorClub) - Number(a.isMotorClub)),
          );
        } else {
          setResults([]);
        }
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <fieldset className="bg-bg-surface-elevated border border-border-on-dark rounded-md p-4 space-y-3">
      <legend className="px-2 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
        Recipients ({recipients.length})
      </legend>

      <div>
        <label htmlFor="tof-account-search" className="block text-xs font-semibold mb-1">
          Search motor-club accounts
        </label>
        <input
          id="tof-account-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Agero, Allstate, Geico…"
          className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
        />
        {query.trim().length >= 2 && (
          <ul className="mt-2 max-h-48 overflow-auto rounded-md border border-border-on-dark bg-bg-base">
            {searching && (
              <li className="px-3 py-2 text-xs text-text-secondary-on-dark">Searching…</li>
            )}
            {!searching && results.length === 0 && (
              <li className="px-3 py-2 text-xs text-text-secondary-on-dark">No matches.</li>
            )}
            {results.map((a) => (
              <li
                key={a.id}
                className="border-b border-border-on-dark/50 last:border-b-0 px-3 py-2 text-sm flex items-center justify-between gap-3"
              >
                <span>
                  {a.name}
                  {a.isMotorClub && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-text-secondary-on-dark">
                      Motor club
                    </span>
                  )}
                </span>
                <AddFromAccountForm
                  accountId={a.id}
                  accountName={a.name}
                  onAdd={(payload) => {
                    onAdd(payload);
                    setQuery('');
                    setResults([]);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {recipients.length > 0 && (
        <ul className="space-y-2">
          {recipients.map((r) => (
            <li
              key={r.clientId}
              className="flex items-start justify-between gap-3 bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
            >
              <div>
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-text-secondary-on-dark">
                  {r.role ? `${r.role} - ` : ''}
                  {r.email}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(r.clientId)}
                className="text-xs text-text-secondary-on-dark hover:text-status-danger-on-dark"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border-on-dark pt-3 space-y-2">
        <p className="text-xs uppercase tracking-wide text-text-secondary-on-dark">
          Add an ad-hoc recipient (no account row required)
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="Name"
            value={adhocName}
            onChange={(e) => setAdhocName(e.target.value)}
            className="bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
          />
          <input
            type="text"
            placeholder="Role (optional)"
            value={adhocRole}
            onChange={(e) => setAdhocRole(e.target.value)}
            className="bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="email@example.com"
            value={adhocEmail}
            onChange={(e) => setAdhocEmail(e.target.value)}
            className="flex-1 bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
          />
          <button
            type="button"
            onClick={() => {
              if (!adhocName.trim() || !adhocEmail.trim()) return;
              onAdd({
                accountId: null,
                name: adhocName.trim(),
                role: adhocRole.trim() || null,
                email: adhocEmail.trim(),
              });
              setAdhocName('');
              setAdhocRole('');
              setAdhocEmail('');
            }}
            className="px-3 py-2 rounded-md border border-border-on-dark text-xs"
          >
            Add
          </button>
        </div>
      </div>
    </fieldset>
  );
}

function AddFromAccountForm({
  accountId,
  accountName,
  onAdd,
}: {
  accountId: string;
  accountName: string;
  onAdd: (r: Omit<Recipient, 'clientId'>) => void;
}): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [role, setRole] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-accent-orange">
        + Add contact
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-1 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !email.trim()) return;
        onAdd({
          accountId,
          name: name.trim(),
          role: role.trim() || null,
          email: email.trim(),
        });
        setOpen(false);
        setName('');
        setRole('');
        setEmail('');
      }}
    >
      <input
        type="text"
        placeholder={`Contact at ${accountName}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="bg-bg-base border border-border-on-dark rounded p-1"
      />
      <input
        type="text"
        placeholder="Role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="bg-bg-base border border-border-on-dark rounded p-1"
      />
      <input
        type="email"
        placeholder="email@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="bg-bg-base border border-border-on-dark rounded p-1"
      />
      <button type="submit" className="text-accent-orange">
        Add
      </button>
    </form>
  );
}

// =====================================================================
// Preview
// =====================================================================
function Preview({
  tenantName,
  senderName,
  title,
  subjectLine,
  narrative,
  tierLabel,
  committedTruckCount,
  eventWindowStart,
  eventWindowEnd,
  acceptanceDeadlineAt,
  defaultForNonResponders,
  recipientCount,
}: {
  tenantName: string;
  senderName: string;
  title: string;
  subjectLine: string;
  narrative: string;
  tierLabel: string;
  committedTruckCount: number;
  eventWindowStart: string;
  eventWindowEnd: string;
  acceptanceDeadlineAt: string;
  defaultForNonResponders: 'opt_out' | 'accept_at_standard_rate';
  recipientCount: number;
}): JSX.Element {
  return (
    <fieldset className="bg-bg-surface-elevated border border-border-on-dark rounded-md p-4 space-y-2 sticky top-4">
      <legend className="px-2 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
        Live preview
      </legend>
      <p className="text-xs text-text-secondary-on-dark">
        Each recipient sees the body below with their own name, role, and a unique signed accept /
        decline link.
      </p>
      <div className="bg-bg-base border border-border-on-dark rounded-md p-3 text-sm space-y-2">
        <div className="text-xs text-text-secondary-on-dark">
          Subject: <span className="text-text-primary-on-dark">{subjectLine || '— missing —'}</span>
        </div>
        <div className="text-xs text-text-secondary-on-dark">
          From:{' '}
          <span className="text-text-primary-on-dark">
            {senderName} - {tenantName}
          </span>
        </div>
        <hr className="border-border-on-dark/50" />
        <h3 className="font-semibold leading-tight">{title || '— missing title —'}</h3>
        <p className="whitespace-pre-line">
          {narrative || 'Write a few sentences explaining what this offer is and why now.'}
        </p>
        <div className="bg-bg-surface-elevated border border-border-on-dark/40 rounded p-2 text-xs">
          <p className="uppercase tracking-wide text-[10px] text-text-secondary-on-dark mb-1">
            What we&rsquo;re committing
          </p>
          <p>
            {committedTruckCount} trucks at the {tierLabel} tier from {eventWindowStart || 'TBD'} →{' '}
            {eventWindowEnd || 'TBD'}.
          </p>
        </div>
        <div className="bg-bg-surface-elevated border border-border-on-dark/40 rounded p-2 text-xs">
          <p className="uppercase tracking-wide text-[10px] text-text-secondary-on-dark mb-1">
            What we&rsquo;re asking
          </p>
          <p>
            Reply by {acceptanceDeadlineAt || 'TBD'}. If you don&rsquo;t reply, our default is:{' '}
            <strong>
              {defaultForNonResponders === 'opt_out'
                ? 'opt out (no premium dispatches accepted)'
                : 'accept dispatches at the standard rate'}
            </strong>
            .
          </p>
        </div>
        <p className="text-[11px] text-text-secondary-on-dark">
          Will be sent to {recipientCount} recipient{recipientCount === 1 ? '' : 's'}.
        </p>
      </div>
    </fieldset>
  );
}
