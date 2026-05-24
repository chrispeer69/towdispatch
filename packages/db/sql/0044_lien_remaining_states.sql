-- =====================================================================
-- 0044_lien_remaining_states.sql  (Lien Processing — Session 35)
--
-- Seeds the per-state statutory rule config for the remaining 40 states +
-- DC into lien_state_rules, completing 50-state + DC coverage. Session 23
-- (0038_lien_processing.sql) shipped the top 10 (CA, TX, FL, NY, GA, NC, OH,
-- IL, PA, MI); this migration adds AK, AL, AR, AZ, CO, CT, DC, DE, HI, IA,
-- ID, IN, KS, KY, LA, MA, MD, ME, MN, MO, MS, MT, ND, NE, NH, NJ, NM, NV,
-- OK, OR, RI, SC, SD, TN, UT, VA, VT, WA, WI, WV, WY (41 rows).
--
-- INSERT-only. No schema change — lien_state_rules (table, CHECK, trigger,
-- grants) already exists from 0038. The rule-engine runtime source of truth
-- is apps/api/src/modules/lien-processing/state-rules.config.ts; this table
-- mirrors it for queryability / auditability. These rows were generated
-- directly from that config so the two cannot drift.
--
-- Idempotent: ON CONFLICT (state) DO NOTHING. Re-running is a no-op and the
-- top-10 rows seeded by 0038 are never touched (no key overlap). If the TS
-- config changes a value for one of these states, ship a follow-up migration
-- that re-seeds it (DO UPDATE) rather than relying on this one.
--
-- ⚠️  LEGAL DISCLAIMER: the day-counts and value thresholds are best-effort
-- interpretations of each jurisdiction's lien-sale statute (cited in the
-- `statute` field) and MUST be reviewed by counsel against the current state
-- code before any production lien sale runs through this code. See
-- SESSION_35_DECISIONS.md for the conservative-vs-aggressive choices.
--
-- Down (rollback): the rows are reference data; to remove only this session's
-- additions:
--   DELETE FROM lien_state_rules WHERE state IN (
--     'AK','AL','AR','AZ','CO','CT','DC','DE','HI','IA','ID','IN','KS','KY',
--     'LA','MA','MD','ME','MN','MO','MS','MT','ND','NE','NH','NJ','NM','NV',
--     'OK','OR','RI','SC','SD','TN','UT','VA','VT','WA','WI','WV','WY');
-- =====================================================================

INSERT INTO lien_state_rules (state, rules) VALUES
  ('AK', '{"statute":"AK Stat. 28.10.471 / 28.10.502 / 34.35.165 (storage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('AL', '{"statute":"AL Code 32-13-1 et seq / 35-11-110 (garage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('AR', '{"statute":"AR Code 27-50-1201 et seq / 18-45-201 (storage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('AZ', '{"statute":"AZ Rev. Stat. 28-4801 et seq / 33-1022 (ADOT abandoned)","dmvLookupWindowDays":5,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('CO', '{"statute":"CO Rev. Stat. 42-4-2101 et seq / 42-4-2103 (abandoned)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('CT', '{"statute":"CT Gen. Stat. 14-150 / 14-66 (storage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":15,"lienholderNoticeWaitDays":15,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('DC', '{"statute":"DC Code 50-2421.01 et seq (abandoned & junk vehicles)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('DE', '{"statute":"DE Code tit. 21 4406 / tit. 25 3901 (garage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('HI', '{"statute":"HI Rev. Stat. 290-1 et seq / 507-18 (storage lien)","dmvLookupWindowDays":10,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":15,"minDaysToSale":60,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('IA', '{"statute":"IA Code 321.89 / 321.90 (abandoned vehicles)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('ID', '{"statute":"ID Code 49-1801 et seq / 45-805 (possessory lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":25,"lienholderNoticeWaitDays":25,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('IN', '{"statute":"IN Code 9-22-1 et seq / 32-33-10 (possessory lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":25,"lienholderNoticeWaitDays":25,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('KS', '{"statute":"KS Stat. 8-1102 / 8-1103 (abandoned/storage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":15,"lienholderNoticeWaitDays":15,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('KY', '{"statute":"KY Rev. Stat. 376.270 / 376.275 (storage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('LA', '{"statute":"LA Rev. Stat. 32:1711 et seq / 9:4501 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":15,"minDaysToSale":60,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('MA', '{"statute":"MA Gen. Laws ch. 90 31A / ch. 255 39A (garage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":45,"publicationRequired":true,"publicationWaitDays":14,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('MD', '{"statute":"MD Transp. 25-201 et seq / Com. Law 16-201 (garage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('ME', '{"statute":"ME Rev. Stat. tit. 29-A 1351 et seq / tit. 10 3801","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('MN', '{"statute":"MN Stat. 168B.01 et seq / 514.18 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('MO', '{"statute":"MO Rev. Stat. 304.155 et seq / 430.082 (towing lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('MS', '{"statute":"MS Code 63-23-1 et seq / 85-7-251 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('MT', '{"statute":"MT Code 61-12-401 et seq / 71-3-1201 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('ND', '{"statute":"ND Cent. Code 39-26-01 et seq / 35-13-01 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('NE', '{"statute":"NE Rev. Stat. 60-1901 et seq / 52-601.01 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('NH', '{"statute":"NH Rev. Stat. 262:31 et seq / 450:1 (garage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":25,"lienholderNoticeWaitDays":25,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('NJ', '{"statute":"NJ Stat. 39:10A-1 et seq / 2A:44-20 (garage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('NM', '{"statute":"NM Stat. 66-3-1 et seq / 48-3-19 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('NV', '{"statute":"NV Rev. Stat. 487.230 et seq / 108.270 (storage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('OK', '{"statute":"OK Stat. tit. 47 901 et seq / tit. 42 91A (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('OR', '{"statute":"OR Rev. Stat. 819.100 et seq / 98.812 (towed vehicle)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('RI', '{"statute":"RI Gen. Laws 31-43-1 et seq / 34-47-1 (garage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('SC', '{"statute":"SC Code 56-5-5630 et seq / 29-15-10 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('SD', '{"statute":"SD Codified Laws 32-30-1 et seq / 32-36 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('TN', '{"statute":"TN Code 55-16-101 et seq / 66-19-103 (garage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('UT', '{"statute":"UT Code 41-6a-1401 et seq / 72-9-603 / 38-2-1 (lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('VA', '{"statute":"VA Code 46.2-1200 et seq / 43-32 (garage lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('VT', '{"statute":"VT Stat. tit. 23 2151 et seq / tit. 9 1961 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('WA', '{"statute":"WA Rev. Code 46.55 / 60.10 (impound & chattel lien)","dmvLookupWindowDays":5,"ownerNoticeWaitDays":15,"lienholderNoticeWaitDays":15,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('WI', '{"statute":"WI Stat. 342.40 / 779.41 (towing lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('WV', '{"statute":"WV Code 17-24-1 et seq / 38-13-1 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":45,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('WY', '{"statute":"WY Stat. 31-13-101 et seq / 29-7-101 (vehicle lien)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb)
ON CONFLICT (state) DO NOTHING;
