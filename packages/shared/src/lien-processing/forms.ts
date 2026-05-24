export const lienFormTypeValues = ['owner_notice', 'publication_notice'] as const;
export type LienFormType = (typeof lienFormTypeValues)[number];

export const lienFormTypeLabel: Record<LienFormType, string> = {
  owner_notice: 'Notice of Lien Sale to Registered Owner / Lienholder',
  publication_notice: 'Notice of Lien Sale for Publication',
};
