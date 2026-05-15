# Towbook Import — Root Cause Diagnosis
**Date:** 2026-05-15
**Session:** 18
**Status:** Root cause identified; fix prepared

## Summary

The Towbook import returned `status='failed'` on every run because **9 of
10 importer classes had no explicit constructor**. NestJS DI emits
`design:paramtypes` metadata from the constructor signature of the class
being instantiated. When a child class extends a parent with a constructor
but declares no constructor of its own, the metadata on the child is
empty, so Nest's `Injector` instantiates the child with **zero
arguments**. The base class's `protected readonly bundle: BundleService`
parameter stays `undefined`.

The first importer phase (customers) runs:

```ts
const getter = this.bundle.buildRowGetter(...)
```

which throws `TypeError: Cannot read properties of undefined (reading
'buildRowGetter')`. The error bubbles out of `ImportRunService.start()`'s
try/catch, the run is marked `status='failed'`, the transaction is rolled
back, and no rows are persisted. From the outside this looked like a
data-layer or SQL bug; in reality the bundle service was never injected.

## Why the audit only saw the surface

The audit unmasked two layered defenses that had been hiding this bug:

1. The test bootstrap was missing the `application/zip` content-type
   parser. Every import request returned 415 long before reaching the
   importers, so the underlying DI bug was invisible.
2. The reconciliation SQL had a `WHERE tenant_id=$1` clause with an empty
   params array. Once the parser fix unstuck the imports, reconciliation
   then 500'd on its own.

Both of those are fixed in this session's earlier commits. With those
out of the way, the actual product bug surfaced: the importer phase
crashes on the first call.

## Evidence

Test debug print at `apps/api/test/integration/import.spec.ts` (added
temporarily for diagnosis, removed before commit):

```
[DRY-RUN-DEBUG] {
  "runId": "019e28cb-8a32-7b5b-9825-9023ef6a7abc",
  "status": "failed",
  "totals": {},
  "message": "Cannot read properties of undefined (reading 'buildRowGetter')"
}
```

The failure happens at `BaseImporter.run()`:

```ts
const getter = this.bundle.buildRowGetter(ctx.mapping, this.csvKey, file.headerMap);
```

`this.bundle` is `undefined`. The base class declares
`constructor(protected readonly bundle: BundleService)`. The child
(`CustomerImporter`, etc.) has no constructor of its own, so:

- TypeScript at runtime emits `class CustomerImporter extends BaseImporter`
  with no own constructor.
- Reflect metadata for `CustomerImporter`'s constructor is `[]` (empty).
- Nest's DI calls `new CustomerImporter()` with zero args.
- The implicit `super(...args)` passes nothing, so `bundle` is `undefined`.

`AttachmentImporter` works because it declares an explicit constructor:

```ts
constructor(
  bundle: BundleService,
  @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
) {
  super(bundle);
}
```

## Importers affected

1. `customer.importer.ts`
2. `vehicle.importer.ts`
3. `driver.importer.ts`
4. `truck.importer.ts`
5. `job.importer.ts`
6. `impound.importer.ts`
7. `invoice.importer.ts`
8. `payment.importer.ts`
9. `motor-club-history.importer.ts`

`attachment.importer.ts` is unaffected (already has an explicit
constructor for its `STORAGE_PROVIDER` dependency).

## Fix

Add an explicit constructor to each of the 9 affected importers:

```ts
constructor(bundle: BundleService) {
  super(bundle);
}
```

This is the minimum change that makes Nest emit the right metadata. No
behavior change beyond DI wiring.

## Why the downstream tests then pass

Once the importers can run, the existing logic in each `importRow()` is
correct:

- Customers dedupe by `(tenant_id, external_id)` → idempotent on second
  run (no duplicate rows; the second run UPDATEs rather than INSERTs).
- The partial unique index `customers_external_unique` in
  `0017_import.sql` enforces this at the DB level too.
- Reconciliation reads back `external_id` rows that the live import
  wrote, so `missing` becomes `[]` after a successful import.

The fix is wholly contained to DI; no schema changes, no business-logic
changes.

## Regression guard

After the fix lands, a smoke test added to the import test suite asserts
that the synthetic bundle produces the expected row counts. The pattern
to watch in future sessions: **any importer added that extends
`BaseImporter` MUST declare an explicit constructor that calls
`super(bundle)`**. Consider a lint rule or a base-class assertion
(`if (!this.bundle) throw new Error('BaseImporter constructed without
bundle')`) so the failure mode is loud, not silent.
