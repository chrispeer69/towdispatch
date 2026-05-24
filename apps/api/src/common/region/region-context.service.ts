/**
 * RegionContextService (Session 44) — the single runtime source of truth for
 * "which region am I, and how healthy is replication".
 *
 * Holds:
 *   - region identity/role (from ConfigService),
 *   - an in-process `lastWriteTs` marker stamped by the region middleware when
 *     this instance accepts a write-intent request (a coarse "is this region
 *     taking writes" signal for the failover runbook — NOT a DB-commit time),
 *   - a best-effort replica-lag reader (delegates to TenantAwareDb),
 *   - a peer-region probe for GET /admin/region-status.
 */
import { Injectable } from '@nestjs/common';
import type { RegionHealth, RegionStatus } from '@ustowdispatch/shared';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

const PEER_PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class RegionContextService {
  private lastWriteTsValue: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly db: TenantAwareDb,
  ) {}

  /** { id, role, isPrimary, peerOrigin, peerHealthcheckUrl, ... } */
  get info() {
    return this.config.region;
  }

  /** Stamp the most recent write-intent request accepted by this instance. */
  markWrite(): void {
    this.lastWriteTsValue = new Date().toISOString();
  }

  get lastWriteTs(): string | null {
    return this.lastWriteTsValue;
  }

  /** Best-effort replication lag (seconds); null when not measurable. */
  replicaLagSeconds(): Promise<number | null> {
    return this.db.replicaLagSeconds();
  }

  /** Health block appended to GET /ready and used by /admin/region-status. */
  async health(): Promise<RegionHealth> {
    return {
      regionId: this.info.id,
      role: this.info.role,
      replicaLagSeconds: await this.replicaLagSeconds(),
      lastWriteTs: this.lastWriteTs,
    };
  }

  /**
   * Probe the peer region's /ready. Returns null when no peer is configured.
   * Never throws — a down or unreachable peer is data, not an error.
   */
  private async fetchPeer(): Promise<RegionStatus['peer']> {
    const base = this.info.peerHealthcheckUrl;
    if (!base) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PEER_PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(base, { signal: controller.signal });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { url: base, reachable: res.ok, status: res.status, body };
    } catch {
      return { url: base, reachable: false, status: null, body: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Full cross-region status: self health + peer probe. */
  async status(): Promise<RegionStatus> {
    return {
      self: await this.health(),
      peer: await this.fetchPeer(),
      replicationLagAlertSeconds: this.info.replicationLagAlertSeconds,
    };
  }
}
