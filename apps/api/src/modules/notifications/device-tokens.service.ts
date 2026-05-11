/**
 * DeviceTokensService — register / refresh / revoke per-user device tokens.
 *
 * Called from the driver app on cold start, on token refresh, and on
 * logout. Tenant-scoped so a token registered under one tenant cannot
 * route notifications targeted to another (the kill-switch invariant).
 */
import { Injectable } from '@nestjs/common';
import { notificationDeviceTokens, uuidv7 } from '@ustowdispatch/db';
import type { RegisterDeviceTokenPayload } from '@ustowdispatch/shared';
import { and, eq } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class DeviceTokensService {
  constructor(private readonly db: TenantAwareDb) {}

  async register(
    ctx: CallerContext,
    body: RegisterDeviceTokenPayload,
  ): Promise<{ id: string }> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        // Upsert on (tenant_id, user_id, device_id) — if the token has
        // rotated, the deviceId stays stable so we update in place.
        const existing = await tx
          .select({ id: notificationDeviceTokens.id })
          .from(notificationDeviceTokens)
          .where(
            and(
              eq(notificationDeviceTokens.tenantId, ctx.tenantId),
              eq(notificationDeviceTokens.userId, ctx.userId),
              eq(notificationDeviceTokens.deviceId, body.deviceId),
            ),
          )
          .limit(1);
        if (existing[0]) {
          await tx
            .update(notificationDeviceTokens)
            .set({
              token: body.token,
              appVersion: body.appVersion ?? null,
              active: true,
              lastSeenAt: new Date(),
              revokedAt: null,
              revokedReason: null,
              updatedAt: new Date(),
            })
            .where(eq(notificationDeviceTokens.id, existing[0].id));
          return { id: existing[0].id };
        }
        const id = uuidv7();
        await tx.insert(notificationDeviceTokens).values({
          id,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          platform: body.platform,
          token: body.token,
          deviceId: body.deviceId,
          appVersion: body.appVersion ?? null,
          active: true,
          lastSeenAt: new Date(),
        });
        return { id };
      },
    );
  }

  async revoke(ctx: CallerContext, deviceId: string, reason: string): Promise<{ ok: boolean }> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        await tx
          .update(notificationDeviceTokens)
          .set({
            active: false,
            revokedAt: new Date(),
            revokedReason: reason,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(notificationDeviceTokens.tenantId, ctx.tenantId),
              eq(notificationDeviceTokens.userId, ctx.userId),
              eq(notificationDeviceTokens.deviceId, deviceId),
            ),
          );
        return { ok: true };
      },
    );
  }

  /**
   * Admin-only — used by the FCM result handler when the provider reports
   * the token is permanently dead. Operates in the caller's tenant scope
   * to keep the tenant-isolation guarantee.
   */
  async softDisableByToken(tx: Tx, tenantId: string, token: string, reason: string): Promise<void> {
    await tx
      .update(notificationDeviceTokens)
      .set({
        active: false,
        revokedAt: new Date(),
        revokedReason: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationDeviceTokens.tenantId, tenantId),
          eq(notificationDeviceTokens.token, token),
        ),
      );
  }
}
