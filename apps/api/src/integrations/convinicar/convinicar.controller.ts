import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentTenant } from '../../common/decorators/current-user.decorator.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { ConvinicarService } from './convinicar.service.js';
import { uuidv7 } from '@ustowdispatch/db';
import { DispatchEventsService } from '../../modules/dispatch/dispatch-events.service.js';

interface ConvinicarWebhookPayload {
  type: string;
  table: string;
  schema: string;
  record: {
    id: string; // tow_offer id
    service_request_id: string;
    vendor_id: string;
    outcome: string;
    expires_at: string;
  };
  enriched_data?: {
    offer: any;
    request: any;
    customer: any;
    vehicle: any;
  };
}

@Controller('integrations/convinicar')
export class ConvinicarController {
  private readonly logger = new Logger(ConvinicarController.name);

  constructor(
    private readonly convinicarService: ConvinicarService,
    private readonly admin: TransactionRunner,
    private readonly configService: ConfigService,
    private readonly dispatchEvents: DispatchEventsService,
  ) {}

  @Public()
  @Post('webhook')
  async handleWebhook(
    @Body() payload: ConvinicarWebhookPayload,
    @Headers('x-webhook-secret') webhookSecret?: string,
  ) {
    const expectedSecret = this.configService.get<string>('CONVINICAR_WEBHOOK_SECRET') || 'local_dev_secret_123';
    if (webhookSecret !== expectedSecret) {
      this.logger.warn('Received webhook with invalid or missing x-webhook-secret');
      throw new UnauthorizedException('Invalid webhook secret');
    }

    this.logger.log(`Received Convinicar webhook: ${JSON.stringify(payload)}`);

    // We only care about new tow_offers that are pending
    if (payload.table !== 'tow_offers' || payload.type !== 'INSERT' || payload.record.outcome !== 'pending') {
      return { status: 'ignored', reason: 'Not a pending tow offer' };
    }

    const { service_request_id, vendor_id, id: offer_id } = payload.record;

    // Look up the matching US Tow Dispatch Tenant
    let matchedTenantId: string | null = null;
    await this.admin.runAsAdmin({}, async (db) => {
      const tenant = await db.query.tenants.findFirst({
        where: (t, { eq }) => eq(t.convinicarVendorId, vendor_id),
        columns: { id: true },
      });
      if (tenant) {
        matchedTenantId = tenant.id;
      }
    });

    if (!matchedTenantId) {
      this.logger.warn(`Received webhook for Convinicar Vendor ${vendor_id}, but no matching USTD Tenant was found!`);
      return { status: 'error', reason: 'Unmapped vendor' };
    }

    this.logger.log(`Successfully mapped Convinicar Vendor ${vendor_id} to USTD Tenant ${matchedTenantId}. Ready to dispatch job ${service_request_id}!`);

    // Insert the skeletal job into US Tow Dispatch
    const jobId = uuidv7();
    await this.admin.runAsAdmin({}, async (_db, client) => {
      // Allocate a job_number
      const now = new Date();
      const dayKey = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
      const seqRes = await client.query<{ last_seq: string | number }>(
        `INSERT INTO job_number_sequences (tenant_id, day_key, last_seq, updated_at)
         VALUES ($1::uuid, $2, 1, now())
         ON CONFLICT (tenant_id, day_key)
         DO UPDATE SET last_seq = job_number_sequences.last_seq + 1, updated_at = now()
         RETURNING last_seq`,
        [matchedTenantId, dayKey],
      );
      const seq = Number(seqRes.rows[0]?.last_seq ?? 0);
      const jobNumber = `${dayKey}-${String(seq).padStart(4, '0')}`;

      // Insert job with 'new' status so it shows up on the board as an offer
      await client.query(
        `INSERT INTO jobs (
            id, tenant_id, job_number, status, service_type,
            pickup_address, authorized_by, rate_quoted_cents, notes,
            created_at, updated_at,
            convinicar_service_request_id, convinicar_offer_id
         ) VALUES (
            $1, $2, $3, 'new', 'tow',
            'Pending Convinicar Location', 'other', 0, 'convinicar:offer',
            now(), now(),
            $4, $5
         ) ON CONFLICT DO NOTHING`,
        [
          jobId,
          matchedTenantId,
          jobNumber,
          service_request_id,
          offer_id,
        ],
      );
    });

    // Notify the frontend via sockets
    await this.admin.runAsAdmin({}, async (db) => {
      const job = await db.query.jobs.findFirst({
        where: (j, { eq }) => eq(j.id, jobId)
      });
      if (job) {
        // Build the basic DTO
        const jobDto = {
          id: job.id,
          tenantId: job.tenantId,
          jobNumber: job.jobNumber,
          status: job.status,
          serviceType: job.serviceType,
          pickupAddress: job.pickupAddress,
          pickupLat: job.pickupLat,
          pickupLng: job.pickupLng,
          dropoffAddress: job.dropoffAddress,
          dropoffLat: job.dropoffLat,
          dropoffLng: job.dropoffLng,
          authorizedBy: job.authorizedBy,
          authorizedByName: job.authorizedByName,
          rateQuotedCents: job.rateQuotedCents,
          rateBreakdown: job.rateBreakdown,
          notes: job.notes,
          cancelledReason: job.cancelledReason,
          assignedDriverId: job.assignedDriverId,
          assignedTruckId: job.assignedTruckId,
          assignedShiftId: job.assignedShiftId,
          assignedAt: job.assignedAt ? job.assignedAt.toISOString() : null,
          createdByUserId: job.createdByUserId,
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
          deletedAt: job.deletedAt ? job.deletedAt.toISOString() : null,
          tierOfferEnforcementStatus: 'none' as const,
          convinicarOfferId: job.convinicarOfferId,
        };
        this.dispatchEvents.emit(matchedTenantId!, 'job.created' as any, { job: jobDto });
      }
    });

    return { status: 'received', offer_id, mapped_tenant_id: matchedTenantId, job_id: jobId };
  }

  @Post(':jobId/accept')
  async acceptOffer(
    @Body() body: { offerId: string },
    @CurrentTenant() currentTenantId: string,
  ) {
    if (!body.offerId) {
      throw new BadRequestException('offerId is required to accept');
    }

    let jobExistsForTenant = false;
    await this.admin.runAsAdmin({}, async (db) => {
      const job = await db.query.jobs.findFirst({
        where: (j, { eq, and }) => and(eq(j.convinicarOfferId, body.offerId), eq(j.tenantId, currentTenantId)),
      });
      if (job) jobExistsForTenant = true;
    });

    if (!jobExistsForTenant) {
      throw new UnauthorizedException('You do not have permission to accept this offer');
    }
    
    // Call Convinicar backend to accept the offer before 120s expires
    const response = await this.convinicarService.respondToOffer(body.offerId, 'accept');
    
    // Update the local USTD job status to 'dispatched'
    await this.admin.runAsAdmin({}, async (_db, client) => {
      await client.query(
        `UPDATE jobs SET status = 'dispatched', updated_at = now() WHERE convinicar_offer_id = $1`,
        [body.offerId],
      );
    });

    return { success: true, convinicar_response: response };
  }

  @Post(':jobId/reject')
  async rejectOffer(
    @Body() body: { offerId: string },
    @CurrentTenant() currentTenantId: string,
  ) {
    if (!body.offerId) {
      throw new BadRequestException('offerId is required to reject');
    }
    
    let jobExistsForTenant = false;
    await this.admin.runAsAdmin({}, async (db) => {
      const job = await db.query.jobs.findFirst({
        where: (j, { eq, and }) => and(eq(j.convinicarOfferId, body.offerId), eq(j.tenantId, currentTenantId)),
      });
      if (job) jobExistsForTenant = true;
    });

    if (!jobExistsForTenant) {
      throw new UnauthorizedException('You do not have permission to reject this offer');
    }

    // Call Convinicar backend to decline the offer so they can route it to the next vendor
    const response = await this.convinicarService.respondToOffer(body.offerId, 'decline');
    
    // Update the local USTD job status to 'cancelled' so it leaves the board
    await this.admin.runAsAdmin({}, async (_db, client) => {
      await client.query(
        `UPDATE jobs SET status = 'cancelled', cancelled_reason = 'Rejected by Dispatcher', updated_at = now() WHERE convinicar_offer_id = $1`,
        [body.offerId],
      );
    });

    return { success: true, convinicar_response: response };
  }
}
