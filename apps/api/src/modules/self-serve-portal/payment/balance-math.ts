/**
 * Pure balance math for the self-serve portal (Session 55).
 *
 * Computes the amount an owner owes from the S22 impound fee ledger (S54
 * storage_charges is absent on master — see SESSION_55_DECISIONS.md D11).
 * Soft-deleted fee rows are ignored. All amounts are integer cents. Grouping:
 *   tow            <- intake
 *   storage        <- daily_storage
 *   administrative <- administrative + lien_processing + gate
 *   other          <- other (+ any unknown type, conservatively)
 */
import type { PortalBalance, PortalBalanceLine } from '@ustowdispatch/shared';

export interface FeeRow {
  feeType: string;
  amountCents: number;
  deletedAt: Date | string | null;
}

const TOW_TYPES = new Set(['intake']);
const STORAGE_TYPES = new Set(['daily_storage']);
const ADMIN_TYPES = new Set(['administrative', 'lien_processing', 'gate']);

const LABELS: Record<string, string> = {
  intake: 'Tow / intake',
  daily_storage: 'Storage (to date)',
  administrative: 'Administrative fee',
  lien_processing: 'Lien processing',
  gate: 'Gate fee',
  other: 'Other',
};

export interface ComputeBalanceInput {
  impoundId: string;
  fees: FeeRow[];
  paidCents: number;
  currency?: string;
  asOf?: Date;
}

export function computeBalance(input: ComputeBalanceInput): PortalBalance {
  const live = input.fees.filter((f) => !f.deletedAt);

  let tow = 0;
  let storage = 0;
  let admin = 0;
  let other = 0;
  const byType = new Map<string, number>();

  for (const f of live) {
    const cents = Math.trunc(f.amountCents);
    byType.set(f.feeType, (byType.get(f.feeType) ?? 0) + cents);
    if (TOW_TYPES.has(f.feeType)) tow += cents;
    else if (STORAGE_TYPES.has(f.feeType)) storage += cents;
    else if (ADMIN_TYPES.has(f.feeType)) admin += cents;
    else other += cents;
  }

  const lines: PortalBalanceLine[] = [...byType.entries()]
    .filter(([, cents]) => cents !== 0)
    .map(([feeType, amountCents]) => ({
      feeType,
      label: LABELS[feeType] ?? feeType,
      amountCents,
    }))
    .sort((a, b) => a.feeType.localeCompare(b.feeType));

  const totalCents = tow + storage + admin + other;
  const paidCents = Math.max(0, Math.trunc(input.paidCents));
  const balanceCents = Math.max(0, totalCents - paidCents);

  return {
    impoundId: input.impoundId,
    currency: input.currency ?? 'usd',
    towChargesCents: tow,
    storageChargesCents: storage,
    administrativeFeesCents: admin,
    otherFeesCents: other,
    totalCents,
    paidCents,
    balanceCents,
    lines,
    asOf: (input.asOf ?? new Date()).toISOString(),
  };
}
