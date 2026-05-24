# Session 35 — Lien Processing: Remaining 40 States + DC — Decisions Log

**Scope:** Extend the Session 23 statutory lien-sale workflow from the top 10
states to **all 50 states + DC**. This session is data + per-state templates +
tests only — the module, pure rule engine, NestJS API, observation-only cron,
shared Zod contracts, and PDF infrastructure already exist from S23 and were
**extended, not modified** (the rule-engine signature is unchanged; S23's 10
state configs are untouched). The 41 jurisdictions added: AK, AL, AR, AZ, CO,
CT, DC, DE, HI, IA, ID, IN, KS, KY, LA, MA, MD, ME, MN, MO, MS, MT, ND, NE, NH,
NJ, NM, NV, OK, OR, RI, SC, SD, TN, UT, VA, VT, WA, WI, WV, WY.

---

## ⚠️ LEGAL DISCLAIMER (read first)

The per-state day-counts, value thresholds, publication rules, and statute
citations added this session are **best-effort interpretations** researched
against best available knowledge. **They are not legal advice and have NOT been
verified against the current state codes.** Every config block cites the
governing statute. **Legal counsel review is required before any production
lien sale runs through this code.** As in S23, the module is built so a human
makes every legal decision: no auto-advance, observation-only cron, sale gated
on `ready_for_sale`.

---

## Conservative posture for the S35 additions

Where a statute's exact day-count or publication mechanism was ambiguous, we
chose the option that **better protects the registered owner** and is the safer
default for an operator — i.e. the longer hold and the extra notice. Concretely:

- **Publication required by default.** Unless a state's process is clearly a
  registry / certified-mail model (DMV-administered abandoned-vehicle programs),
  `publicationRequired: true`. Over-noticing is the conservative error.
- **Certified-only (no publication) states.** A documented minority rely on
  certified mail to the owner/lienholder of record plus the waiting period
  rather than newspaper publication: **AK, AZ, CO, IA, IN, MN, MO, NV, OR, TN,
  WA** (mirrors S23's TX/OH precedent). For these, owner-not-found still
  proceeds on certified notice + the waiting period (the engine already encodes
  this: `isPublicationRequired` returns `false` for states with no publication
  mechanism even when the owner is unknown).
- **Longer holds where the process is slower.** `minDaysToSale` is 45 for states
  with garage-keeper/court-adjacent processes (AL, AR, CT, DC, DE, KY, MA, MD,
  MS, NH, NJ, OK, RI, SC, VA, WV) and **60 for HI and LA** (island logistics /
  longer statutory windows). The remainder use the 30-day floor that matches the
  S23 baseline.
- **Floor on the sale date (unchanged engine rule).** Earliest legal sale date
  is the *max* of the minimum hold AND every applicable notice/publication
  window — never the min. Inherited from S23; the new configs feed it.
- **Unknown value → `mid` tier** (publication stays on); **owner not located →
  publication** in any state that has a publication mechanism. Inherited.
- **Value tiers are a product heuristic, not statutory.** Low ≤ $2,500
  (`lowMaxCents: 250000`), high ≥ $10,000 (`highMinCents: 1000000`) for every
  new state — the same default as most S23 states. They gate only the low-value
  publication exemption. Where a state sets an explicit statutory low-value
  threshold, counsel should adjust at review; we did not invent per-state
  figures we could not source.
- **`lowValuePublicationExempt: true` for all publication states this session.**
  We did not assert a FL-style "no low-value carve-out" for any new state
  without a sourced basis; counsel can flip individual states to `false` (the
  more conservative direction) at review.

## Full coverage table (50 states + DC)

Runtime source of truth:
`apps/api/src/modules/lien-processing/state-rules.config.ts`. S23's top 10 are
seeded by `0038_lien_processing.sql`; the 41 added here by
`0044_lien_remaining_states.sql` (the SQL rows were generated directly from the
TS config, so the two cannot drift).

| State | Statute (best-effort) | DMV win | Owner/lien wait | Publication | Min→sale | Low-value pub exempt |
|-------|----------------------|--------:|----------------:|-------------|---------:|----------------------|
| CA | CA Civil Code 3068.1 / Vehicle Code 22851.12, 22851.10 (low-value) | 3 | 10/10 | yes (+10) | 30 | yes |
| TX | TX Occupations Code 2303 / Property Code 70.006 | 5 | 30/30 | no (certified) | 30 | n/a |
| FL | FL Statutes 713.78 / 713.585 | 7 | 30/30 | yes (+10) | 35 | no |
| NY | NY Lien Law 184 / 200-204 | 5 | 20/20 | yes (+10) | 30 | yes |
| GA | GA Code 40-11-1 through 40-11-19 / 44-1-13 | 5 | 10/10 | yes (+10) | 30 | yes |
| NC | NC Gen Stat 44A-1 through 44A-4 (Chapter 44A Article 1) | 7 | 10/10 | yes (+10) | 30 | yes |
| OH | OH Rev Code 4505.101 / 4513.60-.62 | 5 | 15/15 | no (certified) | 30 | n/a |
| IL | IL 625 ILCS 5/4-201 through 5/4-214 / 770 ILCS 50 | 7 | 15/15 | yes (+10) | 30 | yes |
| PA | PA 75 Pa.C.S. 7301-7305 / Abandoned Vehicle provisions | 7 | 15/15 | yes (+10) | 30 | yes |
| MI | MI Comp Laws 257.252 / 570.521-570.530 | 7 | 20/20 | yes (+10) | 30 | yes |
| AK | AK Stat. 28.10.471 / 28.10.502 / 34.35.165 (storage lien) | 7 | 30/30 | no (certified) | 45 | n/a |
| AL | AL Code 32-13-1 et seq / 35-11-110 (garage lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| AR | AR Code 27-50-1201 et seq / 18-45-201 (storage lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| AZ | AZ Rev. Stat. 28-4801 et seq / 33-1022 (ADOT abandoned) | 5 | 20/20 | no (certified) | 30 | n/a |
| CO | CO Rev. Stat. 42-4-2101 et seq / 42-4-2103 (abandoned) | 7 | 30/30 | no (certified) | 30 | n/a |
| CT | CT Gen. Stat. 14-150 / 14-66 (storage lien) | 7 | 15/15 | yes (+10) | 45 | yes |
| DC | DC Code 50-2421.01 et seq (abandoned & junk vehicles) | 7 | 30/30 | yes (+10) | 45 | yes |
| DE | DE Code tit. 21 4406 / tit. 25 3901 (garage lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| HI | HI Rev. Stat. 290-1 et seq / 507-18 (storage lien) | 10 | 30/30 | yes (+15) | 60 | yes |
| IA | IA Code 321.89 / 321.90 (abandoned vehicles) | 7 | 20/20 | no (certified) | 30 | n/a |
| ID | ID Code 49-1801 et seq / 45-805 (possessory lien) | 7 | 25/25 | yes (+10) | 30 | yes |
| IN | IN Code 9-22-1 et seq / 32-33-10 (possessory lien) | 7 | 25/25 | no (certified) | 30 | n/a |
| KS | KS Stat. 8-1102 / 8-1103 (abandoned/storage lien) | 7 | 15/15 | yes (+10) | 30 | yes |
| KY | KY Rev. Stat. 376.270 / 376.275 (storage lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| LA | LA Rev. Stat. 32:1711 et seq / 9:4501 (vehicle lien) | 7 | 30/30 | yes (+15) | 60 | yes |
| MA | MA Gen. Laws ch. 90 31A / ch. 255 39A (garage lien) | 7 | 30/45 | yes (+14) | 45 | yes |
| MD | MD Transp. 25-201 et seq / Com. Law 16-201 (garage lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| ME | ME Rev. Stat. tit. 29-A 1351 et seq / tit. 10 3801 | 7 | 20/20 | yes (+10) | 30 | yes |
| MN | MN Stat. 168B.01 et seq / 514.18 (vehicle lien) | 7 | 20/20 | no (certified) | 30 | n/a |
| MO | MO Rev. Stat. 304.155 et seq / 430.082 (towing lien) | 7 | 30/30 | no (certified) | 30 | n/a |
| MS | MS Code 63-23-1 et seq / 85-7-251 (vehicle lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| MT | MT Code 61-12-401 et seq / 71-3-1201 (vehicle lien) | 7 | 20/20 | yes (+10) | 30 | yes |
| ND | ND Cent. Code 39-26-01 et seq / 35-13-01 (vehicle lien) | 7 | 20/20 | yes (+10) | 30 | yes |
| NE | NE Rev. Stat. 60-1901 et seq / 52-601.01 (vehicle lien) | 7 | 20/20 | yes (+10) | 30 | yes |
| NH | NH Rev. Stat. 262:31 et seq / 450:1 (garage lien) | 7 | 25/25 | yes (+10) | 45 | yes |
| NJ | NJ Stat. 39:10A-1 et seq / 2A:44-20 (garage lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| NM | NM Stat. 66-3-1 et seq / 48-3-19 (vehicle lien) | 7 | 20/20 | yes (+10) | 30 | yes |
| NV | NV Rev. Stat. 487.230 et seq / 108.270 (storage lien) | 7 | 20/20 | no (certified) | 30 | n/a |
| OK | OK Stat. tit. 47 901 et seq / tit. 42 91A (vehicle lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| OR | OR Rev. Stat. 819.100 et seq / 98.812 (towed vehicle) | 7 | 20/20 | no (certified) | 30 | n/a |
| RI | RI Gen. Laws 31-43-1 et seq / 34-47-1 (garage lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| SC | SC Code 56-5-5630 et seq / 29-15-10 (vehicle lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| SD | SD Codified Laws 32-30-1 et seq / 32-36 (vehicle lien) | 7 | 20/20 | yes (+10) | 30 | yes |
| TN | TN Code 55-16-101 et seq / 66-19-103 (garage lien) | 7 | 20/20 | no (certified) | 30 | n/a |
| UT | UT Code 41-6a-1401 et seq / 72-9-603 / 38-2-1 (lien) | 7 | 20/20 | yes (+10) | 30 | yes |
| VA | VA Code 46.2-1200 et seq / 43-32 (garage lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| VT | VT Stat. tit. 23 2151 et seq / tit. 9 1961 (vehicle lien) | 7 | 20/20 | yes (+10) | 30 | yes |
| WA | WA Rev. Code 46.55 / 60.10 (impound & chattel lien) | 5 | 15/15 | no (certified) | 30 | n/a |
| WI | WI Stat. 342.40 / 779.41 (towing lien) | 7 | 20/20 | yes (+10) | 30 | yes |
| WV | WV Code 17-24-1 et seq / 38-13-1 (vehicle lien) | 7 | 30/30 | yes (+10) | 45 | yes |
| WY | WY Stat. 31-13-101 et seq / 29-7-101 (vehicle lien) | 7 | 20/20 | yes (+10) | 30 | yes |

## Flagged for legal review — non-standard / longest-window states

These were given the most conservative settings and most need counsel sign-off:

- **HI, LA — 60-day holds.** Longest in the set; HI also carries a 15-day
  publication window. Verify the actual statutory minimum.
- **MA — 45-day lienholder wait** (longer than the owner wait). MA's garage-
  keeper process is the strictest lienholder timeline modeled; verify.
- **DC** — District abandoned/junk-vehicle process, not a state code; treated
  conservatively (publication + 45-day hold).
- **Certified-only states (AK, AZ, CO, IA, IN, MN, MO, NV, OR, TN, WA)** — confirm
  each truly lacks a newspaper-publication requirement; if any does require
  publication, flip `publicationRequired` to `true` (the conservative direction).

## PDF template source — generated text notices, one renderer (unchanged from S23)

- **No official state PDF form was sourced this session** (same as S23). All 41
  new states use the **same single PDFKit renderer** driven by the per-state
  rule config. "102 templates" = 51 jurisdictions × 2 form types (owner notice +
  publication notice) as **logical** templates — not 102 files. Each notice
  cites the governing statute and states the vehicle, charges, redemption right,
  and earliest sale date. English body + EN/ES courtesy redemption line, exactly
  as S23.
- **Renderer change (additive only):** extracted a pure `buildLienNoticeContent`
  helper that `draw()` now sources its strings from. No signature change, no
  output change. Rationale: PDFKit deflates its text streams, so the rendered
  Buffer is not greppable; the helper makes the case-id + statute-citation
  content **unit-testable per state** without parsing the PDF, and guarantees
  the document and the assertions cannot drift.

## Tests — parameterized, derived from config

- **Rule engine:** one parameterized suite
  (`lien-rules.remaining-states.spec.ts`) iterating all 41 new states — 452
  tests. Per state: config-shape invariants (schema parse, `lowMax < highMin`,
  `minDaysToSale > 0`, publication-wait consistency), value-tier bucketing at the
  state's own thresholds, opening DMV action, owner-found/not-found and
  lienholder-found/not-found branches, publication branch, the min-days-to-sale
  boundary (`await` at earliest−1 → `mark_ready` at earliest), and the claim
  block. Expectations are **derived from each config**, not transcribed
  constants — this is what validates 41 rule sets without 41 sets of magic
  numbers. The S23 10 keep their bespoke per-state specs (untouched).
- **PDF smoke:** the existing renderer spec now iterates all 51 (102 render
  tests) and adds a content assertion via `buildLienNoticeContent` (case id +
  statute citation present).
- **Integration:** `driveToSale` was generalized to any state with the
  publication / lienholder branches and the backdating window derived from the
  state's config. **5 representatives chosen from rule properties** (not gut):
  - `WA` = `min(minDaysToSale)`=30 + no publication → **short timeline**
  - `HI` = `max(minDaysToSale)`=60 + publication → **long timeline**
  - `MD` = `publicationRequired: true` → **publication path**
  - `MO` = `publicationRequired: false` → **no-publication path**
  - `MA` = `max(lienholderNoticeWaitDays)`=45 + publication → **strict lienholder**
    (driven with a lienholder served, exercising that notice step).
  S23's CA/TX/FL drive-to-sale tests were kept (signature updated).

## Migration & numbering

- `0044_lien_remaining_states.sql` — **INSERT-only**, no schema change
  (`lien_state_rules` table/CHECK/trigger/grants exist from 0038). `ON CONFLICT
  (state) DO NOTHING` per the launch brief: idempotent, and the top-10 rows are
  never touched (no key overlap). 41 rows generated directly from the TS config.
- Launch assigned `0044`. Current `origin/master` tops out at `0042`
  (`0041` damage-analysis / `0043` fraud are on unmerged branches). The migrate
  runner re-applies idempotent `sql/*.sql` every run and gaps are harmless
  (established repo convention); kept the launch-assigned number, contiguity to
  be reconciled at merge.

## Decisions taken without asking (per CLAUDE.md Rule 1)

- **Base branch.** Launch named branch `feature/session-35-lien-remaining-states`
  off master; the worktree was checked out on the S23 branch. S23 PR #106 is
  **merged to master**, so I fetched fresh `origin/master` and branched from it —
  that base has the merged lien module + integration/RLS tests, where branching
  off the pre-merge S23 HEAD would have missed merge-time refinements.
- **Extended the `LienState` union to 51** in shared `state-rules.ts`. This is
  the single lever that drives the `Record<LienState>` key requirement, the
  `z.enum(lienStateValues)` openCase validator, and the PDF smoke iteration —
  the type checker enforces config completeness. The S23 10 entries were left in
  place; the 41 were appended.
- **Updated the integration assertion `10 → 51`.** The `/lien-cases/state-rules`
  endpoint serves `Object.keys(LIEN_STATE_RULES)`, so it legitimately returns 51
  now. Updating a stale count is not "modifying S23's rules."

## Deferred (🟡)

- **Integration suite not run live** — no Postgres in this sandbox (`skipIfNoDb`
  skips it, as in CI where only e2e runs). It typechecks clean and mirrors the
  proven S23 flow; needs a `docker compose up db` run to exercise end-to-end.
- **Counsel verification** of every new day-count / publication flag (see flagged
  states above) — the core deferral, by design.
- **Official fillable state forms** (vs generated text notices) — still deferred.
- **DMV lookup API integration**, **tenant-level rule overrides**, **sale-proceeds
  accounting** — unchanged S23 deferrals.
