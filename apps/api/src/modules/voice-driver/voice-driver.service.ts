/**
 * VoiceDriverService — the brain of the hands-free driver workflow
 * (Session 45).
 *
 * It does NOT own any job business logic. It parses a spoken transcript
 * into an intent (pure parser), resolves the driver's target job, and maps
 * the intent onto the EXISTING job-status transitions by delegating to
 * `JobsService.transition` — the very same path the offline-sync replay
 * uses. Voice is just another front door onto the state machine.
 *
 * Destructive intents (decline_job / clear_job / mark_breakdown) are gated
 * behind a spoken confirmation. There is no in-memory session: a pending
 * confirmation is a `voice_command_log` row with `confirmation_required =
 * true AND confirmed_at IS NULL AND succeeded = false`, found by driver
 * within a short TTL when the next utterance is a bare "yes" / "no".
 *
 * Every processed command writes exactly one voice_command_log row
 * (tenant-isolated, audited). Spoken responses are bilingual.
 */
import { Injectable } from '@nestjs/common';
import { jobs, uuidv7, voiceCommandLog } from '@ustowdispatch/db';
import type {
  VoiceCommandRequest,
  VoiceCommandResponse,
  VoiceIntent,
  VoiceLocale,
  VoicePlatform,
} from '@ustowdispatch/shared';
import { isDestructiveIntent } from '@ustowdispatch/shared';
import type { JobStatus } from '@ustowdispatch/shared';
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { extractReason, parseIntent } from './voice-intent.parser.js';
import { type VoiceResponseKey, phaseWord, renderResponse } from './voice-responses.js';

/** Driver identity + request metadata for a voice command. */
export interface VoiceDriverCtx {
  tenantId: string;
  driverId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Non-terminal statuses a voice command can act on (mirrors the state machine). */
const ACTIVE_STATUSES: JobStatus[] = ['dispatched', 'enroute', 'on_scene', 'in_progress'];

/** Intents that move the job through the state machine. */
const TRANSITION_FOR_INTENT: Partial<Record<VoiceIntent, JobStatus>> = {
  en_route: 'enroute',
  arrive_on_scene: 'on_scene',
  vehicle_loaded: 'in_progress',
  clear_job: 'completed',
  decline_job: 'cancelled',
};

/** Spoken-confirmation prompt per destructive intent. */
const CONFIRM_PROMPT: Partial<Record<VoiceIntent, VoiceResponseKey>> = {
  decline_job: 'confirm_decline',
  clear_job: 'confirm_clear',
  mark_breakdown: 'confirm_breakdown',
};

/** Pending confirmations older than this are ignored (advisor-recommended). */
const CONFIRM_TTL_MS = 90_000;

interface ResolvedJob {
  id: string;
  status: JobStatus;
  pickupAddress: string;
  dropoffAddress: string | null;
}

interface JobResolution {
  job: ResolvedJob | null;
  reason: 'ok' | 'no_active_job' | 'multiple_active' | 'not_found';
}

@Injectable()
export class VoiceDriverService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Process one spoken command. The controller has already enforced the
   * VOICE_DRIVER_ENABLED gate and driver authentication.
   */
  async handleCommand(
    ctx: VoiceDriverCtx,
    request: VoiceCommandRequest,
  ): Promise<VoiceCommandResponse> {
    const locale = request.locale;
    const platform = request.platform;
    const parsed = parseIntent(request.transcript, {
      confidenceThreshold: this.config.voiceDriverConfidenceMin,
    });

    // --- 1. Spoken confirmation of a pending destructive action ---------
    // A bare yes/no (no other intent) resolves the most recent pending
    // confirmation for this driver.
    if (parsed.rawIntent === null && parsed.entities.confirmation !== undefined) {
      return this.resolvePendingConfirmation(ctx, request, parsed.entities.confirmation);
    }

    // --- 2. Sub-threshold / unrecognized → clarify ----------------------
    if (parsed.intent === 'clarify') {
      const text =
        locale === 'en' && parsed.suggestedRephrase
          ? parsed.suggestedRephrase
          : renderResponse('clarify', locale);
      await this.log(ctx, {
        request,
        recognizedIntent: 'clarify',
        confidence: parsed.confidence,
        jobId: request.jobId ?? null,
        actionTaken: 'clarify',
        succeeded: false,
        confirmationRequired: false,
      });
      return this.response('clarify', parsed.confidence, false, text, {
        followUpQuestion: text,
        confirmationRequired: false,
        jobId: request.jobId ?? null,
        jobStatus: null,
      });
    }

    const intent = parsed.intent as VoiceIntent;

    // --- 3. Resolve the target job (most intents are job-scoped) --------
    const jobOptional = intent === 'request_help' || intent === 'mark_breakdown';
    const resolution = await this.resolveJob(ctx, request.jobId);
    if (!resolution.job && !jobOptional) {
      const key: VoiceResponseKey =
        resolution.reason === 'multiple_active' ? 'multiple_jobs' : 'no_active_job';
      const text = renderResponse(key, locale);
      await this.log(ctx, {
        request,
        recognizedIntent: intent,
        confidence: parsed.confidence,
        jobId: request.jobId ?? null,
        actionTaken: `unresolved:${resolution.reason}`,
        succeeded: false,
        confirmationRequired: false,
      });
      return this.response(intent, parsed.confidence, false, text, {
        followUpQuestion: text,
        confirmationRequired: false,
        jobId: null,
        jobStatus: null,
      });
    }
    const job = resolution.job;

    // --- 4. Destructive intents → queue a confirmation ------------------
    if (isDestructiveIntent(intent)) {
      const promptKey = CONFIRM_PROMPT[intent];
      const text = renderResponse(promptKey ?? 'clarify', locale);
      await this.log(ctx, {
        request,
        recognizedIntent: intent,
        confidence: parsed.confidence,
        jobId: job?.id ?? null,
        actionTaken: 'awaiting_confirmation',
        succeeded: false,
        confirmationRequired: true,
      });
      return this.response(intent, parsed.confidence, false, text, {
        followUpQuestion: text,
        confirmationRequired: true,
        jobId: job?.id ?? null,
        jobStatus: job?.status ?? null,
      });
    }

    // --- 5. Non-destructive intents → execute now -----------------------
    return this.execute(ctx, request, intent, job, parsed.confidence);
  }

  // ---------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------

  /** Execute a non-destructive intent (or a confirmed destructive one). */
  private async execute(
    ctx: VoiceDriverCtx,
    request: VoiceCommandRequest,
    intent: VoiceIntent,
    job: ResolvedJob | null,
    confidence: number,
    opts: { reasonOverride?: string } = {},
  ): Promise<VoiceCommandResponse> {
    const locale = request.locale;

    // Status-changing intents → delegate to JobsService.transition.
    const toStatus = TRANSITION_FOR_INTENT[intent];
    if (toStatus && job) {
      try {
        const reason =
          intent === 'decline_job'
            ? (opts.reasonOverride ?? extractReason(request.transcript))
            : undefined;
        const updated = await this.jobs.transition(this.jobsCtx(ctx), job.id, toStatus, reason);
        const key = SUCCESS_KEY_FOR_INTENT[intent] ?? 'clarify';
        const text = renderResponse(key, locale);
        await this.log(ctx, {
          request,
          recognizedIntent: intent,
          confidence,
          jobId: job.id,
          actionTaken: `transition:${toStatus}`,
          succeeded: true,
          confirmationRequired: false,
        });
        return this.response(intent, confidence, true, text, {
          followUpQuestion: null,
          confirmationRequired: false,
          jobId: job.id,
          jobStatus: updated.status,
        });
      } catch (err) {
        // Illegal transition (e.g. "on scene" before "en route"): surface a
        // spoken explanation, do not crash.
        const text = renderResponse('invalid_transition', locale, {
          status: localizedStatus(job.status, locale),
        });
        await this.log(ctx, {
          request,
          recognizedIntent: intent,
          confidence,
          jobId: job.id,
          actionTaken: `transition_failed:${toStatus}`,
          succeeded: false,
          error: errMessage(err),
          confirmationRequired: false,
        });
        return this.response(intent, confidence, false, text, {
          followUpQuestion: text,
          confirmationRequired: false,
          jobId: job.id,
          jobStatus: job.status,
        });
      }
    }

    // Non-transition intents (informational / read-only).
    return this.executeInformational(ctx, request, intent, job, confidence);
  }

  private async executeInformational(
    ctx: VoiceDriverCtx,
    request: VoiceCommandRequest,
    intent: VoiceIntent,
    job: ResolvedJob | null,
    confidence: number,
  ): Promise<VoiceCommandResponse> {
    const locale = request.locale;
    let text: string;
    let actionTaken = 'informational';
    let followUp: string | null = null;

    switch (intent) {
      case 'accept_job':
        text = renderResponse('accept_ok', locale);
        actionTaken = 'acknowledged';
        break;
      case 'en_route_drop':
        text = renderResponse('en_route_drop_ok', locale);
        break;
      case 'arrive_drop':
        text = renderResponse('arrive_drop_ok', locale);
        break;
      case 'request_help':
        text = renderResponse('help_ok', locale);
        actionTaken = 'escalation:help_requested';
        break;
      case 'repeat_address': {
        if (!job) {
          text = renderResponse('no_active_job', locale);
          followUp = text;
          break;
        }
        // After loading, the next leg is the drop-off; before that, pickup.
        const useDropoff = job.status === 'in_progress' && !!job.dropoffAddress;
        const address = useDropoff ? job.dropoffAddress : job.pickupAddress;
        text = address
          ? renderResponse('repeat_address', locale, {
              phase: phaseWord(useDropoff ? 'dropoff' : 'pickup', locale),
              address,
            })
          : renderResponse('repeat_address_none', locale);
        actionTaken = 'read:address';
        break;
      }
      case 'eta_update': {
        const minutes = parseIntent(request.transcript, {
          confidenceThreshold: 0,
        }).entities.minutes;
        if (minutes === undefined) {
          text = renderResponse('eta_no_minutes', locale);
          followUp = text;
          actionTaken = 'eta_missing_minutes';
        } else {
          text = renderResponse('eta_ok', locale, { minutes });
          actionTaken = `eta:${minutes}`;
        }
        break;
      }
      default:
        text = renderResponse('clarify', locale);
        followUp = text;
        actionTaken = 'clarify';
    }

    await this.log(ctx, {
      request,
      recognizedIntent: intent,
      confidence,
      jobId: job?.id ?? null,
      actionTaken,
      succeeded: actionTaken !== 'clarify' && actionTaken !== 'eta_missing_minutes',
      confirmationRequired: false,
    });
    return this.response(intent, confidence, false, text, {
      followUpQuestion: followUp,
      confirmationRequired: false,
      jobId: job?.id ?? null,
      jobStatus: job?.status ?? null,
    });
  }

  // ---------------------------------------------------------------------
  // Confirmation flow
  // ---------------------------------------------------------------------

  private async resolvePendingConfirmation(
    ctx: VoiceDriverCtx,
    request: VoiceCommandRequest,
    confirmed: boolean,
  ): Promise<VoiceCommandResponse> {
    const locale = request.locale;
    const pending = await this.findPendingConfirmation(ctx);

    if (!pending) {
      const text = renderResponse('nothing_to_confirm', locale);
      await this.log(ctx, {
        request,
        recognizedIntent: confirmed ? 'confirm_yes' : 'confirm_no',
        confidence: 1,
        jobId: null,
        actionTaken: 'nothing_to_confirm',
        succeeded: false,
        confirmationRequired: false,
      });
      return this.response('clarify', 1, false, text, {
        followUpQuestion: null,
        confirmationRequired: false,
        jobId: null,
        jobStatus: null,
      });
    }

    const pendingIntent = pending.recognizedIntent as VoiceIntent;

    if (!confirmed) {
      // Resolve the pending row as declined; do not execute.
      await this.resolvePendingRow(ctx, pending.id, {
        confirmedAt: new Date(),
        succeeded: false,
        actionTaken: 'confirmation_declined',
      });
      const text = renderResponse('confirm_cancelled', locale);
      await this.log(ctx, {
        request,
        recognizedIntent: 'confirm_no',
        confidence: 1,
        jobId: pending.jobId,
        actionTaken: 'confirmation_declined',
        succeeded: true,
        confirmationRequired: false,
      });
      return this.response('clarify', 1, false, text, {
        followUpQuestion: null,
        confirmationRequired: false,
        jobId: pending.jobId,
        jobStatus: null,
      });
    }

    // Confirmed: execute the queued destructive action.
    const job = pending.jobId ? await this.loadJob(ctx, pending.jobId) : null;
    let response: VoiceCommandResponse;
    let executedOk = true;
    let errorText: string | undefined;
    let newStatus: string | null = null;

    try {
      if (pendingIntent === 'mark_breakdown') {
        // Informational escalation; no state transition (a driver-truck
        // breakdown is not a job cancellation — see SESSION_45_DECISIONS.md).
        const text = renderResponse('breakdown_ok', locale);
        response = this.response('mark_breakdown', 1, true, text, {
          followUpQuestion: null,
          confirmationRequired: false,
          jobId: pending.jobId,
          jobStatus: job?.status ?? null,
        });
      } else if (job) {
        const toStatus = TRANSITION_FOR_INTENT[pendingIntent];
        const reason =
          pendingIntent === 'decline_job' ? extractReason(pending.commandText) : undefined;
        const updated = await this.jobs.transition(
          this.jobsCtx(ctx),
          job.id,
          toStatus as JobStatus,
          reason,
        );
        newStatus = updated.status;
        const key = SUCCESS_KEY_FOR_INTENT[pendingIntent] ?? 'clarify';
        response = this.response(pendingIntent, 1, true, renderResponse(key, locale), {
          followUpQuestion: null,
          confirmationRequired: false,
          jobId: job.id,
          jobStatus: updated.status,
        });
      } else {
        executedOk = false;
        const text = renderResponse('no_active_job', locale);
        response = this.response(pendingIntent, 1, false, text, {
          followUpQuestion: null,
          confirmationRequired: false,
          jobId: null,
          jobStatus: null,
        });
      }
    } catch (err) {
      executedOk = false;
      errorText = errMessage(err);
      const text = renderResponse('invalid_transition', locale, {
        status: job ? localizedStatus(job.status, locale) : '',
      });
      response = this.response(pendingIntent, 1, false, text, {
        followUpQuestion: text,
        confirmationRequired: false,
        jobId: pending.jobId,
        jobStatus: job?.status ?? null,
      });
    }

    // Mark the pending row resolved (executed or attempted) ...
    await this.resolvePendingRow(ctx, pending.id, {
      confirmedAt: new Date(),
      succeeded: executedOk,
      actionTaken: executedOk ? `confirmed:${pendingIntent}` : `confirm_failed:${pendingIntent}`,
      error: errorText,
    });
    // ... and record the "yes" utterance as its own audited row.
    await this.log(ctx, {
      request,
      recognizedIntent: 'confirm_yes',
      confidence: 1,
      jobId: pending.jobId,
      actionTaken: executedOk ? `executed:${pendingIntent}` : `execute_failed:${pendingIntent}`,
      succeeded: executedOk,
      error: errorText,
      confirmationRequired: false,
    });
    void newStatus;
    return response;
  }

  private async findPendingConfirmation(ctx: VoiceDriverCtx): Promise<{
    id: string;
    recognizedIntent: string;
    jobId: string | null;
    commandText: string;
  } | null> {
    const cutoff = new Date(Date.now() - CONFIRM_TTL_MS);
    return this.db.runInTenantContext(this.tenantCtx(ctx), async (tx) => {
      const rows = await tx
        .select({
          id: voiceCommandLog.id,
          recognizedIntent: voiceCommandLog.recognizedIntent,
          jobId: voiceCommandLog.jobId,
          commandText: voiceCommandLog.commandText,
        })
        .from(voiceCommandLog)
        .where(
          and(
            eq(voiceCommandLog.driverId, ctx.driverId),
            eq(voiceCommandLog.confirmationRequired, true),
            isNull(voiceCommandLog.confirmedAt),
            eq(voiceCommandLog.succeeded, false),
            isNull(voiceCommandLog.deletedAt),
            gte(voiceCommandLog.occurredAt, cutoff),
          ),
        )
        .orderBy(desc(voiceCommandLog.occurredAt))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  private async resolvePendingRow(
    ctx: VoiceDriverCtx,
    id: string,
    patch: {
      confirmedAt: Date;
      succeeded: boolean;
      actionTaken: string;
      error?: string | undefined;
    },
  ): Promise<void> {
    await this.db.runInTenantContext(this.tenantCtx(ctx), async (tx) => {
      await tx
        .update(voiceCommandLog)
        .set({
          confirmedAt: patch.confirmedAt,
          succeeded: patch.succeeded,
          actionTaken: patch.actionTaken,
          error: patch.error ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(voiceCommandLog.id, id), isNull(voiceCommandLog.deletedAt)));
    });
  }

  // ---------------------------------------------------------------------
  // Job resolution
  // ---------------------------------------------------------------------

  private async resolveJob(ctx: VoiceDriverCtx, jobId?: string): Promise<JobResolution> {
    return this.db.runInTenantContext(this.tenantCtx(ctx), async (tx) => {
      const base = and(
        eq(jobs.assignedDriverId, ctx.driverId),
        inArray(jobs.status, ACTIVE_STATUSES),
        isNull(jobs.deletedAt),
      );
      const rows = await tx
        .select({
          id: jobs.id,
          status: jobs.status,
          pickupAddress: jobs.pickupAddress,
          dropoffAddress: jobs.dropoffAddress,
        })
        .from(jobs)
        .where(jobId ? and(base, eq(jobs.id, jobId)) : base)
        .orderBy(desc(jobs.assignedAt))
        .limit(5);

      if (jobId) {
        const match = rows.find((r) => r.id === jobId);
        return match ? { job: match, reason: 'ok' } : { job: null, reason: 'not_found' };
      }
      if (rows.length === 0) return { job: null, reason: 'no_active_job' };
      if (rows.length > 1) return { job: null, reason: 'multiple_active' };
      return { job: rows[0] ? { ...rows[0] } : null, reason: 'ok' };
    });
  }

  private async loadJob(ctx: VoiceDriverCtx, jobId: string): Promise<ResolvedJob | null> {
    return this.db.runInTenantContext(this.tenantCtx(ctx), async (tx) => {
      const row = await tx.query.jobs.findFirst({
        where: and(
          eq(jobs.id, jobId),
          eq(jobs.assignedDriverId, ctx.driverId),
          isNull(jobs.deletedAt),
        ),
        columns: { id: true, status: true, pickupAddress: true, dropoffAddress: true },
      });
      return row
        ? {
            id: row.id,
            status: row.status,
            pickupAddress: row.pickupAddress,
            dropoffAddress: row.dropoffAddress,
          }
        : null;
    });
  }

  // ---------------------------------------------------------------------
  // Logging + helpers
  // ---------------------------------------------------------------------

  private async log(
    ctx: VoiceDriverCtx,
    row: {
      request: VoiceCommandRequest;
      recognizedIntent: string;
      confidence: number;
      jobId: string | null;
      actionTaken: string;
      succeeded: boolean;
      confirmationRequired: boolean;
      error?: string | undefined;
    },
  ): Promise<void> {
    await this.db.runInTenantContext(this.tenantCtx(ctx), async (tx) => {
      await tx.insert(voiceCommandLog).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        driverId: ctx.driverId,
        jobId: row.jobId,
        commandText: row.request.transcript.slice(0, 2000),
        recognizedIntent:
          row.recognizedIntent as typeof voiceCommandLog.$inferInsert.recognizedIntent,
        intentConfidence: clamp01(row.confidence),
        actionTaken: row.actionTaken,
        succeeded: row.succeeded,
        error: row.error ?? null,
        confirmationRequired: row.confirmationRequired,
        platform: row.request.platform as VoicePlatform,
        locale: row.request.locale,
        createdBy: null,
      });
    });
  }

  private response(
    recognizedIntent: VoiceCommandResponse['recognizedIntent'],
    confidence: number,
    actionExecuted: boolean,
    responseText: string,
    rest: {
      followUpQuestion: string | null;
      confirmationRequired: boolean;
      jobId: string | null;
      jobStatus: string | null;
    },
  ): VoiceCommandResponse {
    return {
      recognizedIntent,
      confidence: clamp01(confidence),
      actionExecuted,
      responseText,
      followUpQuestion: rest.followUpQuestion,
      confirmationRequired: rest.confirmationRequired,
      jobId: rest.jobId,
      jobStatus: rest.jobStatus,
    };
  }

  private jobsCtx(ctx: VoiceDriverCtx): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.driverId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    };
  }

  private tenantCtx(ctx: VoiceDriverCtx): { tenantId: string; userId: string; requestId: string } {
    return { tenantId: ctx.tenantId, userId: ctx.driverId, requestId: ctx.requestId };
  }
}

const SUCCESS_KEY_FOR_INTENT: Partial<Record<VoiceIntent, VoiceResponseKey>> = {
  en_route: 'enroute_ok',
  arrive_on_scene: 'on_scene_ok',
  vehicle_loaded: 'loaded_ok',
  clear_job: 'cleared_ok',
  decline_job: 'declined_ok',
};

const STATUS_ES: Readonly<Record<string, string>> = {
  new: 'nuevo',
  dispatched: 'despachado',
  enroute: 'en camino',
  on_scene: 'en el lugar',
  in_progress: 'en progreso',
  completed: 'completado',
  cancelled: 'cancelado',
  goa: 'sin vehículo',
};

function localizedStatus(status: string, locale: VoiceLocale): string {
  if (locale === 'es') return STATUS_ES[status] ?? status;
  return status.replace(/_/g, ' ');
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
}
