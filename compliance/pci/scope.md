# PCI DSS — Cardholder Data Environment (CDE) Scope

**Merchant level:** Level 4 by transaction volume; validating with **SAQ A-EP**
(see [SESSION_40_DECISIONS.md](../../SESSION_40_DECISIONS.md) D2 for why A-EP and
not SAQ A or SAQ D).

**Assessment date:** 2026-05-24 · **Next annual assessment due:** 2027-05-24

## Core assertion

> US Tow DISPATCH **never** stores, processes, or transmits a Primary Account
> Number (PAN), CVV, or full track data on its own systems. All cardholder data
> is captured directly by Stripe Elements / Stripe.js into a Stripe-hosted iframe
> and exchanged for an opaque token. Our servers and database see only Stripe
> identifiers (`payment_method`, `setup_intent`, `customer`, `charge` ids).

This is enforced in code, not just asserted on paper:

- `scripts/compliance/verify-stripe-only.ts` fails CI if any raw card field
  (`card_number`, `cvv`, `cvc`, `security_code`, …) appears as a DB column or a
  form input we render.
- `scripts/compliance/verify-no-pan-logs.ts` fails CI if a Luhn-valid PAN literal
  appears in the payment code path or any log file, or if a card-field
  identifier is ever passed to a logger.

Both run in `pnpm compliance:type2-check` and the weekly security workflow.

## What is in scope (SAQ A-EP)

The **page that loads the Stripe payment element** is in scope, because we
control it and a compromise of that page could redirect the cardholder's PAN.
In scope therefore:

- The web app origin(s) serving the checkout/payment page.
- The `<script>`/CSP surface that loads `js.stripe.com` (see `CSP_SCRIPT_SRC`,
  `CSP_FRAME_SRC` in `apps/api/src/config/config.schema.ts`).
- TLS termination and the integrity of the delivered page (SRI / CSP).
- Access control + change management + logging over that code path.

## What is NOT in scope

- Storage of PAN/CVV — **does not exist** (no raw card columns; verified in CI).
- The Stripe iframe internals and Stripe's infrastructure — Stripe's own PCI DSS
  Level 1 attestation covers these (see [vendors.md](../vendors.md)).
- Backend services that only ever handle Stripe tokens/ids.

## CDE boundary summary

| Asset | Touches PAN? | In CDE? | Control |
|---|---|---|---|
| Stripe Elements iframe | Yes (Stripe-hosted) | Stripe's scope | Stripe PCI L1 |
| Web checkout page (ours) | No (hosts the iframe) | **Yes (A-EP)** | CSP, SRI, TLS, change mgmt |
| API payments module | No (tokens only) | Supporting | `verify-no-pan-logs`, audit log |
| PostgreSQL | No (ids only) | Out | `verify-stripe-only`, RLS, encryption at rest |
| Logs / Sentry | No (PII redacted) | Out | `verify-no-pan-logs`, log redaction |

See [network-diagram.md](network-diagram.md) for the data flow and
[controls.md](controls.md) for the 12-requirement mapping.
