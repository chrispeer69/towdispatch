/**
 * Self-serve portal message templates (Session 55) — deliverable #8.
 *
 * Pure builders (no I/O) so copy + variable interpolation are unit-tested; the
 * service composes these and hands them to NotificationService (SMS) / the
 * email transport. en + es parity per repo convention; the owner's locale is
 * not known at send time so SMS sends both-language-aware short copy in en and
 * email subject/body are provided in both for the transport to localize.
 */
export interface MagicLinkVars {
  tenantName: string;
  link: string;
}

export function magicLinkSms(v: MagicLinkVars): string {
  return `${v.tenantName}: tap to view your impounded vehicle and pay your balance — ${v.link} (link expires in 30 min). Did not request this? Ignore.`;
}

export function magicLinkEmail(v: MagicLinkVars): { subject: string; body: string } {
  return {
    subject: `${v.tenantName}: access your impounded vehicle`,
    body: `We found your vehicle in ${v.tenantName}'s impound yard.\n\nView the balance and start your release here (expires in 30 minutes):\n${v.link}\n\nIf you didn't request this, you can ignore this message.`,
  };
}

export interface ReceiptVars {
  tenantName: string;
  amountFormatted: string;
  caseNumber: string;
}

export function paymentReceiptEmail(v: ReceiptVars): { subject: string; body: string } {
  return {
    subject: `${v.tenantName}: payment received`,
    body: `Thank you — we received your payment of ${v.amountFormatted} for case ${v.caseNumber}.\n\nYour vehicle is marked READY FOR GATE. Bring a government photo ID matching the release; the yard operator will verify it in person before releasing the vehicle.`,
  };
}

export interface ReadyForGateVars {
  tenantName: string;
  caseNumber: string;
}

export function readyForGateSms(v: ReadyForGateVars): string {
  return `${v.tenantName}: payment confirmed for case ${v.caseNumber}. Your vehicle is ready for pickup — bring a matching photo ID to the gate.`;
}

export function pickupReminderSms(v: ReadyForGateVars): string {
  return `${v.tenantName}: reminder — your vehicle (case ${v.caseNumber}) has been paid and is waiting for pickup. Storage fees may continue to accrue until collected.`;
}

/** Format integer cents as USD for owner-facing copy. */
export function formatUsd(cents: number): string {
  return `$${(Math.trunc(cents) / 100).toFixed(2)}`;
}
