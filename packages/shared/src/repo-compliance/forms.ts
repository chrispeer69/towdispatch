/**
 * Repo Compliance (Session 51) — repossession notice form types.
 *
 * Three statutory notices span the self-help repossession lifecycle. One PDF
 * renderer (repo-form.renderer.ts), driven by the per-state rule config + the
 * form type, covers all 51 jurisdictions × 3 form types.
 */
export const repoFormTypeValues = [
  // Pre-repossession Notice of Default and Right to Cure (cure states).
  'pre_repo_notice',
  // Post-repossession Notice of Intent to dispose / "Notice of Our Plan to
  // Sell Property" (UCC §9-611 / §9-614).
  'post_repo_notice',
  // Post-disposition Explanation of Calculation of Surplus or Deficiency
  // (UCC §9-616).
  'deficiency_notice',
] as const;
export type RepoFormType = (typeof repoFormTypeValues)[number];

export const repoFormTypeLabel: Record<RepoFormType, string> = {
  pre_repo_notice: 'Notice of Default and Right to Cure',
  post_repo_notice: 'Notice of Intent to Dispose of Collateral',
  deficiency_notice: 'Explanation of Calculation of Surplus or Deficiency',
};

// Delivery methods recorded against a repossession notice (parity with the
// lien module; certified mail is the conservative default for repo notices).
export const repoDeliveryMethodValues = [
  'certified_mail',
  'first_class_mail',
  'electronic',
  'in_person',
] as const;
export type RepoDeliveryMethod = (typeof repoDeliveryMethodValues)[number];
