/**
 * Public tracking Socket.IO namespace — /track.
 *
 * Auth model: client connects with `auth.token` set to the tracking link
 * token. We resolve the token via TrackingService.resolveToken (admin pool)
 * to learn the (tenant_id, job_id) tuple, and the socket joins exactly one
 * room: `track:<trackingLinkId>`. No tenant-wide rooms; every customer's
 * connection is isolated to its own job.
 *
 * Server-side fan-out: the dispatch events bus already publishes job status
 * + driver location changes per-tenant. We subscribe once at boot, and for
 * every event whose jobId matches an open tracking link, we re-emit on the
 * /track namespace to the matching tracking-link room — with the friendly
 * status label translation done here so the customer page never sees the
 * raw enum.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { trackingLinks } from '@towcommand/db';
import {
  DISPATCH_EVENTS,
  type DriverLocationChangedEvent,
  type JobStatusChangedEvent,
  TRACKING_EVENTS,
  type TrackingLanguage,
  type TrackingMessageReceivedEvent,
  trackingStatusLabel,
} from '@towcommand/shared';
import { eq } from 'drizzle-orm';
import type { Namespace, Server } from 'socket.io';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { DispatchEventsService } from '../dispatch/dispatch-events.service.js';
import { TrackingService } from './tracking.service.js';

@Injectable()
export class TrackingGateway implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TrackingGateway.name);
  private nsp: Namespace | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly events: DispatchEventsService,
    private readonly tracking: TrackingService,
    private readonly admin: TransactionRunner,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe(async (tenantId, event) => {
      // We only care about a few event types; ignore the rest cheaply.
      if (
        event.name !== DISPATCH_EVENTS.JOB_STATUS_CHANGED &&
        event.name !== DISPATCH_EVENTS.DRIVER_LOCATION_CHANGED &&
        event.name !== DISPATCH_EVENTS.TRACKING_MESSAGE_RECEIVED
      ) {
        return;
      }
      const nsp = this.nsp;
      if (!nsp) return;

      try {
        if (event.name === DISPATCH_EVENTS.JOB_STATUS_CHANGED) {
          const payload = event.payload as JobStatusChangedEvent;
          const link = await this.findActiveLinkForJob(payload.jobId);
          if (!link) return;
          // Translate to friendly label here; customer page never sees enums.
          const room = roomForLink(link.id);
          for (const lang of ['en', 'es'] as TrackingLanguage[]) {
            nsp.to(`${room}:${lang}`).emit(TRACKING_EVENTS.STATUS_CHANGED, {
              status: payload.toStatus,
              statusLabel: trackingStatusLabel(
                payload.toStatus as Parameters<typeof trackingStatusLabel>[0],
                lang,
              ),
            });
          }
        } else if (event.name === DISPATCH_EVENTS.DRIVER_LOCATION_CHANGED) {
          const payload = event.payload as DriverLocationChangedEvent;
          // We can't filter by job here without an extra query, so we emit on
          // every active link for the tenant — but isolated per room (room
          // subscribers are by tracking link id, not by tenant).
          // We could push smarter routing later; for now, look up which jobs
          // are tied to the driver's open shift via the tracking_links table.
          const links = await this.findActiveLinksForDriver(tenantId, payload.driverId);
          for (const link of links) {
            const room = roomForLink(link.id);
            nsp.to(`${room}:en`).emit(TRACKING_EVENTS.DRIVER_LOCATION, {
              lat: payload.lat,
              lng: payload.lng,
              recordedAt: payload.recordedAt,
            });
            nsp.to(`${room}:es`).emit(TRACKING_EVENTS.DRIVER_LOCATION, {
              lat: payload.lat,
              lng: payload.lng,
              recordedAt: payload.recordedAt,
            });
          }
        } else if (event.name === DISPATCH_EVENTS.TRACKING_MESSAGE_RECEIVED) {
          const payload = event.payload as TrackingMessageReceivedEvent;
          // Customer-side gets dispatcher-outbound + system messages.
          if (payload.direction === 'inbound') return;
          const link = await this.findActiveLinkForJob(payload.jobId);
          if (!link) return;
          const room = roomForLink(link.id);
          nsp.to(`${room}:en`).emit(TRACKING_EVENTS.MESSAGE_FROM_DISPATCH, {
            id: payload.messageId,
            body: payload.body,
            createdAt: payload.createdAt,
            direction: payload.direction,
          });
          nsp.to(`${room}:es`).emit(TRACKING_EVENTS.MESSAGE_FROM_DISPATCH, {
            id: payload.messageId,
            body: payload.body,
            createdAt: payload.createdAt,
            direction: payload.direction,
          });
        }
      } catch (err) {
        this.log.warn(
          `tracking event fan-out failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  /**
   * Attach the namespace handlers. Called by main.ts after the dispatch
   * gateway has attached the io server.
   */
  attachNamespace(io: Server): void {
    const nsp = io.of('/track');
    nsp.use(async (socket, next) => {
      const auth = (socket.handshake.auth ?? {}) as { token?: string; lang?: string };
      const token = typeof auth.token === 'string' ? auth.token : null;
      if (!token) return next(new Error('missing-token'));
      try {
        const resolved = await this.tracking.resolveToken(token);
        if (!resolved) return next(new Error('unknown-token'));
        socket.data = {
          trackingLinkId: resolved.trackingLinkId,
          tenantId: resolved.tenantId,
          jobId: resolved.jobId,
          lang: auth.lang === 'es' ? 'es' : 'en',
        };
        next();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'auth-failed';
        return next(new Error(msg));
      }
    });

    nsp.on('connection', (socket) => {
      const data = socket.data as {
        trackingLinkId: string;
        jobId: string;
        lang: TrackingLanguage;
      };
      const room = `${roomForLink(data.trackingLinkId)}:${data.lang}`;
      socket.join(room);
      this.log.debug(`tracking socket ${socket.id} joined ${room}`);
    });

    this.nsp = nsp;
    this.log.log('Tracking gateway attached at /track');
  }

  async onModuleDestroy(): Promise<void> {
    this.unsubscribe?.();
    if (this.nsp) {
      // Disconnecting the parent IO closes namespaces; don't double-close here.
      this.nsp = null;
    }
  }

  private async findActiveLinkForJob(jobId: string): Promise<{
    id: string;
    tenantId: string;
    jobId: string;
  } | null> {
    return this.admin.runAsAdmin({}, async (db) => {
      const link = await db.query.trackingLinks.findFirst({
        where: eq(trackingLinks.jobId, jobId),
      });
      if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) return null;
      return { id: link.id, tenantId: link.tenantId, jobId: link.jobId };
    });
  }

  private async findActiveLinksForDriver(
    tenantId: string,
    driverId: string,
  ): Promise<{ id: string; tenantId: string; jobId: string }[]> {
    return this.admin.runAsAdmin({}, async (db) => {
      // tracking_links don't store driverId directly; resolve via the
      // jobs.assigned_driver_id on the link's job row.
      const rows = await db.query.trackingLinks.findMany({
        where: eq(trackingLinks.tenantId, tenantId),
      });
      const live = rows.filter((r) => !r.revokedAt && r.expiresAt.getTime() > Date.now());
      if (live.length === 0) return [];
      const jobIds = live.map((r) => r.jobId);
      const matchedJobs = await db.query.jobs.findMany({
        where: (j, { inArray }) => inArray(j.id, jobIds),
      });
      const matchSet = new Set(
        matchedJobs.filter((j) => j.assignedDriverId === driverId).map((j) => j.id),
      );
      return live
        .filter((r) => matchSet.has(r.jobId))
        .map((r) => ({ id: r.id, tenantId: r.tenantId, jobId: r.jobId }));
    });
  }
}

export function roomForLink(linkId: string): string {
  return `track:${linkId}`;
}
