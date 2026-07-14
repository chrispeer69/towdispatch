export * from './tenants';
export * from './users';
export * from './user-invites';
export * from './sessions';
export * from './audit-log';
export * from './email-verification-tokens';
export * from './password-reset-tokens';
export * from './accounts';
export * from './customers';
export * from './vehicles';
export * from './customer-vehicles';
export * from './rate-sheets';
export * from './service-catalog';
export * from './service-rates';
export * from './account-rate-overrides';
export * from './account-service-availability';
export * from './jobs';
export * from './drivers';
export * from './trucks';
export * from './driver-shifts';
export * from './driver-truck-assignments';
export * from './documents';
export * from './dvirs';
export * from './maintenance';
export * from './tracking-links';
export * from './invoices';
export * from './invoice-line-commissions';
export * from './job-driver-assignments';
export * from './statement-sends';
export * from './red-alert-sends';
export * from './dynamic-pricing-tiers';
export * from './dynamic-pricing-tier-activations';
export * from './dynamic-pricing-curves';
export * from './dynamic-pricing-noaa-mappings';
export * from './dynamic-pricing-holiday-calendar';
export * from './dynamic-pricing-overrides';
export * from './quote-save-workflow-events';
export * from './dynamic-pricing-pulse-daily';
export * from './invoice-line-dynamic-pricing-audit';
export * from './dynamic-pricing-demand-surge-suggestions';
export * from './stripe-events';
export * from './accounting-connections';
export * from './account-mappings';
export * from './sync-jobs';
export * from './chat';
// Driver Experience (Session 1) — schema foundation for the in-truck app.
// Tables defined in packages/db/sql/0033_driver_experience.sql.
export * from './driver-pins';
export * from './driver-daily-briefings';
export * from './driver-briefing-acknowledgments';
export * from './driver-pretrip-inspections';
export * from './driver-telemetry-events';
export * from './job-evidence';
export * from './job-field-payments';
export * from './driver-offline-actions';
// Tier Offer Composer (Session 1) — Moat #3 schema foundation. Tables in
// packages/db/sql/0034_tier_offer_composer.sql.
export * from './tier-offers';
export * from './tier-offer-recipients';
// Impound & Storage (Session 22) — yard management, holds, fee accrual,
// release workflow. Tables in packages/db/sql/0036_impound_storage.sql.
export * from './impound-yards';
export * from './impound-records';
export * from './impound-holds';
export * from './impound-fees';
export * from './impound-releases';
// Yard Management (Session 54) — operator yard floor layered over S22 impound:
// facilities, stall map + photos, storage rate cards, auto-billing runs +
// per-day charge ledger, and the gated release workflow. Tables in
// packages/db/sql/0051_yard_management.sql.
export * from './yard-facilities';
export * from './yard-stalls';
export * from './yard-stall-photos';
export * from './storage-rate-cards';
export * from './storage-billing-runs';
export * from './storage-charges';
export * from './release-workflows';
export * from './commission-rules';
export * from './reporting';
// Reporting builder + KPI dashboard (Session 53) — additive to ./reporting.
export * from './reporting-builder';
// Lien Processing (Session 23) — statutory lien-sale workflow for unclaimed
// impounded vehicles. Tables in packages/db/sql/0038_lien_processing.sql.
export * from './lien-state-rules';
export * from './lien-cases';
export * from './lien-notices';
export * from './lien-timeline-events';
// EV-Specific Recovery Workflows (Session 48) — EV-aware recovery layer over
// the jobs module. Tables in packages/db/sql/0042_ev_recovery.sql.
export * from './ev-oem-procedures';
export * from './ev-job-attributes';
export * from './ev-thermal-events';
export * from './ev-charge-station-visits';
// Heavy-Duty Specialist (Session 36) — Class 7/8 + commercial recovery
// layer on trucks / drivers / jobs. Tables in
// packages/db/sql/0040_heavy_duty.sql.
export * from './hd-truck-capabilities';
export * from './hd-driver-certifications';
export * from './hd-job-attributes';
export * from './hd-rate-sheets';
// Voice-Controlled Driver Workflows (Session 45) — CarPlay / Android Auto
// hands-free job actions. Audit table in packages/db/sql/0046_voice_commands.sql.
export * from './voice-command-log';
// Public REST API + Webhooks (Session 29) — API-key auth, webhook endpoints,
// delivery ledger, idempotency cache. Tables in
// packages/db/sql/0037_public_api.sql.
export * from './api-keys';
export * from './webhook-endpoints';
export * from './webhook-deliveries';
export * from './api-idempotency-keys';
// White-Label Customer Portal (Session 32) — tenant branding + portal
// logins. Tables in packages/db/sql/0037_white_label_portal.sql.
export * from './tenant-branding';
export * from './customer-portal-users';
export * from './customer-portal-auth-tokens';
// Auction & Remarketing Marketplace (Session 33) — listings, bids, bidders,
// photos. Tables in packages/db/sql/0038_auction_marketplace.sql.
export * from './auction-bidders';
export * from './auction-listings';
export * from './auction-bids';
export * from './auction-listing-photos';
// Fraud Detection (Session 43) — defensive analytics scoring job fraud /
// dispute risk + a dispute log with ground-truth feedback. Tables in
// packages/db/sql/0043_fraud_detection.sql.
export * from './fraud-risk-signals';
export * from './fraud-risk-scores';
export * from './dispute-records';
export * from './dispute-outcomes';
// Photo Damage Analysis (Session 42) — AI-vision damage detection over
// evidence photos, pre/post comparison. Tables in
// packages/db/sql/0041_damage_analysis.sql.
export * from './damage-analyses';
export * from './damage-findings';
export * from './damage-comparisons';
// Full DOT Compliance (Session 37) — carrier profile, DQ-file extension,
// HOS logs, drug & alcohol tests, incident register. DVIR is reused from
// the existing `dvirs` table. Tables in packages/db/sql/0040_dot_compliance.sql.
export * from './dot-carrier-profile';
export * from './dot-driver-qualifications';
export * from './dot-hos-logs';
export * from './dot-drug-alcohol-tests';
export * from './dot-incident-reports';
// Canada Expansion (Session 47) — country/province lookup + jurisdiction tax
// rates (GST/HST/PST/QST). Global reference data. Tables in
// packages/db/sql/0047_canada_expansion.sql.
export * from './jurisdictions';
export * from './tax-rules';
// AI Smart Dispatch (Session 41) — advisory candidate scoring + predictive ETA
// + feedback loop. Tables in packages/db/sql/0045_ai_dispatch.sql.
export * from './dispatch-recommendations';
export * from './dispatch-outcomes';
export * from './eta-predictions';
export * from './notifications';
// Enterprise SSO (Session 38) — SAML 2.0 / OIDC connections, SCIM 2.0
// provisioning tokens + group mirror, login audit. Tables in
// packages/db/sql/0048_enterprise_sso.sql.
export * from './sso-connections';
export * from './scim-tokens';
export * from './sso-login-audit';
export * from './scim-groups';
export * from './scim-group-members';
// Repossession Workflow (Session 49) — lienholder book + case lifecycle
// (attempts, recovery, personal property, condition photos). Distinct legal
// posture from impound (S22) and lien sale (S23/S35). Tables in
// packages/db/sql/0051_repo_workflow.sql.
export * from './lienholders';
export * from './repo-cases';
export * from './repo-location-attempts';
export * from './repo-recovery-events';
export * from './repo-personal-property';
export * from './repo-condition-photos';
// Customer Self-Serve Portal (Session 55) — account-less per-impound sessions,
// self-attested ID, release intents, Stripe payment mirror. Tables in
// packages/db/sql/0051_self_serve_portal.sql.
export * from './customer-portal-sessions';
export * from './customer-portal-id-verifications';
export * from './customer-portal-release-intents';
export * from './customer-portal-payments';
// Capacity-Aware Dispatch Signaling (CADS) — live load ratio per duty class,
// tenant-configurable bands, partner broadcast receipts. Tables in
// packages/db/sql/0052_capacity_signaling.sql.
export * from './capacity';
