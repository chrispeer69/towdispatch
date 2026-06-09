# PCI DSS — Cardholder Data Flow & CDE Boundary

The PAN is entered into a Stripe-hosted iframe and never crosses our boundary.
We exchange a client-side token for a charge; only Stripe identifiers are stored.

```mermaid
flowchart LR
    subgraph Cardholder["Cardholder browser"]
        page["Our checkout page<br/>(in PCI scope — SAQ A-EP)"]
        iframe["Stripe Elements iframe<br/>(Stripe-hosted, Stripe's scope)"]
        page -. loads .-> iframe
    end

    subgraph Stripe["Stripe (PCI DSS Level 1)"]
        stripeapi["api.stripe.com"]
    end

    subgraph Ours["US Tow Dispatch (CDE boundary)"]
        web["Web app origin"]
        api["API payments module<br/>(tokens / ids only)"]
        db[("PostgreSQL<br/>Stripe ids only — no PAN")]
        logs["Logs / Sentry<br/>PII + PAN redacted"]
    end

    iframe -- "PAN (TLS, direct)" --> stripeapi
    stripeapi -- "payment_method / token" --> iframe
    page -- "token only" --> web
    web --> api
    api -- "create charge (token)" --> stripeapi
    stripeapi -- "charge id, status" --> api
    api -- "store stripe ids" --> db
    api -. "redacted events" .-> logs

    classDef cde fill:#fde,stroke:#b36;
    classDef out fill:#eef,stroke:#46b;
    class page,web cde;
    class api,db,logs out;
```

**Reading the diagram**

- The **red** nodes (our checkout page, web origin) are in PCI scope under
  SAQ A-EP — they deliver the page that loads Stripe's element.
- The PAN travels on the **solid cardholder→Stripe edge only**. It never touches
  the blue (our backend) nodes.
- Everything we persist or log is a Stripe identifier or redacted metadata,
  enforced by `verify-stripe-only.ts` and `verify-no-pan-logs.ts`.
