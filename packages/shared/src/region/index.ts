/**
 * Multi-Region (Session 44) — Zod contracts barrel.
 *
 * Foundation for active-active across two regions (primary US-East, secondary
 * US-West). v1 ships primary/secondary + read replicas + region-aware write
 * pinning — the managed-Postgres providers can't host the DB active-active
 * today. See SESSION_44_DECISIONS.md for the full posture.
 *
 * These are the wire contracts for GET /admin/region, GET /admin/region-status,
 * and the region block appended to GET /ready.
 */
import { z } from 'zod';

/** The two regions this deployment targets. Forward-compatible: add a value
 *  here (and a Railway service) to introduce a third region. */
export const regionIdSchema = z.enum(['us-east', 'us-west']);
export type RegionId = z.infer<typeof regionIdSchema>;

/** Primary takes writes; secondary serves reads and refuses tenant writes. */
export const regionRoleSchema = z.enum(['primary', 'secondary']);
export type RegionRole = z.infer<typeof regionRoleSchema>;

/** Identity of the region serving the current process. */
export const regionInfoSchema = z.object({
  regionId: regionIdSchema,
  role: regionRoleSchema,
  isPrimary: z.boolean(),
});
export type RegionInfo = z.infer<typeof regionInfoSchema>;

/** Replication / write health for one region. `replicaLagSeconds` is null when
 *  no distinct read replica is configured (single-region deployments).
 *  `lastWriteTs` is the most recent write-intent request this instance
 *  accepted since boot (null if none) — a coarse "is this region taking
 *  writes" signal for the failover runbook, not a DB-commit timestamp. */
export const regionHealthSchema = z.object({
  regionId: regionIdSchema,
  role: regionRoleSchema,
  replicaLagSeconds: z.number().nullable(),
  lastWriteTs: z.string().datetime().nullable(),
});
export type RegionHealth = z.infer<typeof regionHealthSchema>;

/** GET /admin/region-status — this region plus, when
 *  PRIMARY_REGION_HEALTHCHECK_URL is set, the peer region's /ready snapshot. */
export const regionStatusSchema = z.object({
  self: regionHealthSchema,
  peer: z
    .object({
      url: z.string().url(),
      reachable: z.boolean(),
      status: z.number().nullable(),
      body: z.unknown().nullable(),
    })
    .nullable(),
  replicationLagAlertSeconds: z.number(),
});
export type RegionStatus = z.infer<typeof regionStatusSchema>;

/** Header a client may send to express a region preference. Honored only when
 *  it matches the tenant's `preferred_region` pin. Routing on it is deferred
 *  to the edge/DNS layer (owner-side) — the API validates and echoes only. */
export const PREFERRED_REGION_HEADER = 'x-preferred-region';
