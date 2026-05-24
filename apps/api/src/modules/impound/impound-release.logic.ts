/**
 * Pure release-workflow rules for the impound module: the documentation
 * gate that must pass before a vehicle leaves the yard, and the
 * state-form generation stub (the real documents land in Session 23).
 * No I/O — unit-tested directly.
 */
import type { ImpoundFormKind, ImpoundFormStub, ImpoundRecordStatus } from '@ustowdispatch/shared';

export interface ReleaseGateInput {
  recordStatus: ImpoundRecordStatus;
  activeHoldCount: number;
  idVerified: boolean;
  ownershipDocVerified: boolean;
}

export interface ReleaseGateResult {
  ok: boolean;
  reasons: string[];
}

/**
 * The release documentation gate. A vehicle may only be released when:
 *   - it is still in storage (not already released/transferred/disposed),
 *   - it carries zero active legal holds,
 *   - a government ID has been verified, and
 *   - proof of ownership has been verified.
 * Returns every failing reason so the operator sees the full checklist,
 * not just the first problem.
 */
export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const reasons: string[] = [];
  if (input.recordStatus === 'released') {
    reasons.push('Record is already released.');
  }
  if (input.recordStatus === 'transferred' || input.recordStatus === 'disposed') {
    reasons.push(`Record is ${input.recordStatus} and cannot be released.`);
  }
  if (input.activeHoldCount > 0) {
    reasons.push(
      `${input.activeHoldCount} active hold(s) must be released before the vehicle can leave the yard.`,
    );
  }
  if (!input.idVerified) {
    reasons.push('Government-issued ID must be verified before release.');
  }
  if (!input.ownershipDocVerified) {
    reasons.push('Proof of ownership must be verified before release.');
  }
  return { ok: reasons.length === 0, reasons };
}

export interface FormStubContext {
  recordId: string;
  yardName: string;
  vehicleDescription: string;
  licensePlate: string | null;
  vehicleVin: string | null;
  arrivedAt: string;
  daysStored: number;
  feeTotalCents: number;
  lienEligible: boolean;
}

const FORM_LABELS: Record<ImpoundFormKind, string> = {
  lien_notice: 'Mechanic/Storage Lien Notice',
  release_authorization: 'Vehicle Release Authorization',
  abandoned_vehicle_notice: 'Abandoned Vehicle Notice',
  storage_invoice: 'Storage & Towing Invoice',
};

/**
 * Build a state-form stub. Session 23 replaces `status: 'stub'` with a
 * rendered PDF; the `fields` map is the stable contract the renderer will
 * consume, surfaced now so the web UI can be built ahead of the document
 * work.
 */
export function buildImpoundFormStub(
  kind: ImpoundFormKind,
  ctx: FormStubContext,
  now: Date,
): ImpoundFormStub {
  return {
    kind,
    recordId: ctx.recordId,
    generatedAt: now.toISOString(),
    status: 'stub',
    message: `${FORM_LABELS[kind]} generation is stubbed; the rendered document lands in Session 23.`,
    fields: {
      yardName: ctx.yardName,
      vehicleDescription: ctx.vehicleDescription,
      licensePlate: ctx.licensePlate,
      vehicleVin: ctx.vehicleVin,
      arrivedAt: ctx.arrivedAt,
      daysStored: ctx.daysStored,
      feeTotalCents: ctx.feeTotalCents,
      lienEligible: ctx.lienEligible,
    },
  };
}
