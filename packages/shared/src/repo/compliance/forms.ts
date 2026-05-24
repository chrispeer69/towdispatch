/**
 * Repo Compliance (Session 50) — PDF form contracts.
 *
 * Two rendered notice types per state (post-repossession notice + personal-
 * property notice). No official state PDF was sourced; each is a compliant
 * text document citing the governing statute — see SESSION_50_DECISIONS.md D2.
 *
 * The render endpoint is POST /repo-compliance/forms/:formType (self-contained
 * preview — takes the render context in the body). The case-bound
 * GET /repo-cases/:id/forms/:type lands with the S49 integration (D4).
 */
import { z } from 'zod';
import { repoStateValues } from './state-rules';

export const repoFormTypeValues = ['post_repo_notice', 'personal_property_notice'] as const;
export type RepoFormType = (typeof repoFormTypeValues)[number];

export const repoFormTypeLabel: Record<RepoFormType, string> = {
  post_repo_notice: 'Notice of Repossession and Right to Redeem / Cure',
  personal_property_notice: 'Notice of Personal Property Recovered with Vehicle',
};

// POST body for the self-contained form-render endpoint.
export const renderRepoFormSchema = z
  .object({
    state: z.enum(repoStateValues),
    repoCaseId: z.string().uuid().optional(),
    tenantName: z.string().max(300).optional(),
    debtorName: z.string().max(300).optional(),
    debtorAddress: z.string().max(2000).optional(),
    vehicleDescription: z.string().max(500).optional(),
    vehicleVin: z.string().max(64).optional(),
    licensePlate: z.string().max(32).optional(),
    recoveredAt: z.string().datetime(),
    accruedChargesCents: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .strict();
export type RenderRepoFormPayload = z.infer<typeof renderRepoFormSchema>;
