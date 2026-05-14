/**
 * ChatService — driver↔dispatcher messaging keyed by job.
 *
 * One thread per job, lazily created when the first message is sent. Service
 * enforces:
 *   1. Tenant isolation through TenantAwareDb (RLS belt + suspenders).
 *   2. Participant check — a driver may only post to a job currently
 *      assigned to them; dispatchers/admins/managers may post to any job
 *      in the tenant.
 *   3. Idempotency — on POST, if (tenant, thread, clientMessageId) already
 *      exists, return the existing message. The partial unique index is
 *      the storage-layer enforcement; the in-service lookup is the read
 *      path that returns the prior message without an insert race.
 *   4. Notifications — after a successful insert, enqueue a push to the
 *      other party. Failure to enqueue is logged, never bubbled.
 *
 * Pagination is cursor-based: (createdAt DESC, id DESC) — the supporting
 * index lives in 0011_chat / 0016_chat. Cursors encode `${createdAtISO}:${id}`
 * and are opaque to callers.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type ChatAttachmentType,
  type ChatAuthorRole,
  chatMessages,
  chatThreads,
  drivers,
  jobs,
  users,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type AttachmentUrlRequestPayload,
  type AttachmentUrlResponse,
  type ChatMessageDto,
  type ChatMessageKind,
  ERROR_CODES,
  type ListChatMessagesQuery,
  type ListChatMessagesResponse,
  ROLES,
  type Role,
  type SendChatMessagePayload,
} from '@ustowdispatch/shared';
import { type SQL, and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { NotificationService } from '../../integrations/notification/notification.service.js';
import { ChatServiceTestables } from './chat.testables.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

interface ParticipantInfo {
  isDriverOnJob: boolean;
  /** drivers.id of the driver assigned to the job (null if no driver assigned). */
  assignedDriverId: string | null;
  /** The job's tenant — should always match ctx.tenantId once RLS is in effect. */
  jobExists: boolean;
}

@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly notifications: NotificationService,
  ) {}

  // ---------- sending a message ----------
  async send(
    ctx: CallerContext,
    jobId: string,
    payload: SendChatMessagePayload,
  ): Promise<ChatMessageDto> {
    // Cross-validate: the body's jobId must match the URL's jobId. iOS
    // sends both; we trust neither without confirmation.
    if (payload.jobId !== jobId) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'jobId in body does not match URL',
      });
    }

    const authorRole = this.deriveAuthorRole(ctx.role);
    const attachmentType = this.kindToAttachment(payload.kind);

    const dto = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const participant = await this.loadParticipant(tx, ctx, jobId);
      if (!participant.jobExists) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Job not found' });
      }
      this.assertParticipant(ctx, participant);

      const thread = await this.ensureThread(tx, ctx, jobId);

      // Idempotency lookup BEFORE insert: a retry within the 24h window
      // (or any window — we don't expire client_message_id, it's a stable
      // dedupe key for the lifetime of the row) returns the prior message.
      const existing = await tx.query.chatMessages.findFirst({
        where: and(
          eq(chatMessages.threadId, thread.id),
          eq(chatMessages.clientMessageId, payload.clientMessageId),
        ),
      });
      if (existing) {
        return rowToDto(existing, jobId);
      }

      const body = payload.body ?? null;
      const attachmentUrl = payload.attachmentUrl ?? null;
      // Service-layer enforcement of the DB CHECK constraint, with a clearer
      // error than 23514 if someone bypasses the validator.
      if (attachmentType === 'none') {
        if (!body || body.trim().length === 0) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Text messages require a non-empty body',
          });
        }
      } else if (!attachmentUrl) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Attachment messages require attachmentUrl',
        });
      }

      const id = uuidv7();
      const [row] = await tx
        .insert(chatMessages)
        .values({
          id,
          tenantId: ctx.tenantId,
          threadId: thread.id,
          authorUserId: ctx.userId,
          authorRole,
          body,
          attachmentUrl,
          attachmentType,
          clientMessageId: payload.clientMessageId,
        })
        .returning();
      if (!row) throw new Error('insert chat_messages returned no row');

      // Bump the thread's updated_at so list-of-active-chats can sort.
      await tx
        .update(chatThreads)
        .set({ updatedAt: new Date() })
        .where(eq(chatThreads.id, thread.id));

      return rowToDto(row, jobId);
    });

    // Push notification to the other party, fire-and-forget — never block
    // the response on a notification provider hiccup.
    void this.enqueueNotification(ctx, jobId, dto).catch((err) => {
      this.log.warn(
        `chat notification enqueue failed (tenant=${ctx.tenantId} job=${jobId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return dto;
  }

  // ---------- listing messages ----------
  async list(
    ctx: CallerContext,
    jobId: string,
    query: ListChatMessagesQuery,
  ): Promise<ListChatMessagesResponse> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const participant = await this.loadParticipant(tx, ctx, jobId);
      if (!participant.jobExists) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Job not found' });
      }
      this.assertParticipant(ctx, participant);

      // No thread yet ⇒ empty list, no cursor.
      const thread = await tx.query.chatThreads.findFirst({
        where: eq(chatThreads.jobId, jobId),
      });
      if (!thread) {
        return { messages: [], nextCursor: null };
      }

      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const cursorClause: SQL<unknown> | undefined = cursor
        ? (or(
            lt(chatMessages.createdAt, cursor.createdAt),
            and(eq(chatMessages.createdAt, cursor.createdAt), lt(chatMessages.id, cursor.id)),
          ) as SQL<unknown>)
        : undefined;

      const whereExpr = cursorClause
        ? and(eq(chatMessages.threadId, thread.id), cursorClause)
        : eq(chatMessages.threadId, thread.id);

      // Fetch limit+1 to know whether more pages exist.
      const rows = await tx.query.chatMessages.findMany({
        where: whereExpr,
        orderBy: (t) => [desc(t.createdAt), desc(t.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

      return {
        messages: page.map((r) => rowToDto(r, jobId)),
        nextCursor,
      };
    });
  }

  // ---------- mark read ----------
  async markRead(ctx: CallerContext, messageId: string): Promise<ChatMessageDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const msg = await tx.query.chatMessages.findFirst({
        where: eq(chatMessages.id, messageId),
      });
      if (!msg) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Message not found' });
      }

      const thread = await tx.query.chatThreads.findFirst({
        where: eq(chatThreads.id, msg.threadId),
      });
      if (!thread) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Thread not found' });
      }

      const participant = await this.loadParticipant(tx, ctx, thread.jobId);
      this.assertParticipant(ctx, participant);

      // Can't mark your own message as read — that would let a sender hide
      // their own unread count and is just nonsense semantically.
      if (msg.authorUserId === ctx.userId) {
        return rowToDto(msg, thread.jobId);
      }

      // Idempotent: only update on first mark.
      if (msg.readAt) {
        return rowToDto(msg, thread.jobId);
      }
      const now = new Date();
      const [updated] = await tx
        .update(chatMessages)
        .set({
          readAt: now,
          // Marking read also implies delivered, if delivery wasn't already
          // stamped. This collapses two state transitions for clients that
          // don't bother sending a separate delivered ack.
          deliveredAt: msg.deliveredAt ?? now,
        })
        .where(eq(chatMessages.id, messageId))
        .returning();
      if (!updated) throw new Error('update chat_messages returned no row');
      return rowToDto(updated, thread.jobId);
    });
  }

  // ---------- presigned attachment URL ----------
  async mintAttachmentUrl(
    ctx: CallerContext,
    messageId: string,
    payload: AttachmentUrlRequestPayload,
  ): Promise<AttachmentUrlResponse> {
    // We use the message_id as a stable hint for the storage key prefix. The
    // message row need not exist yet — iOS may mint a URL, upload, then send
    // the message — but if it does we sanity check tenant + participant.
    await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const msg = await tx.query.chatMessages.findFirst({
        where: eq(chatMessages.id, messageId),
      });
      if (msg) {
        const thread = await tx.query.chatThreads.findFirst({
          where: eq(chatThreads.id, msg.threadId),
        });
        if (thread) {
          const participant = await this.loadParticipant(tx, ctx, thread.jobId);
          this.assertParticipant(ctx, participant);
        }
      }
    });

    // Local-disk dev: synthesize a stable would-be-presigned URL. Production
    // S3 wiring lives behind the STORAGE_PROVIDER; when that lands this
    // method delegates to provider.presignPut(...) and returns the real URL.
    // The contract is what iOS depends on; the implementation can swap.
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const key = `tenants/${ctx.tenantId}/chat/${messageId}/${payload.kind}`;
    return {
      uploadUrl: `local://${key}?expires=${encodeURIComponent(expiresAt)}`,
      attachmentUrl: `/files/${key}`,
      expiresAt,
    };
  }

  // ---------- internal helpers ----------
  private async ensureThread(tx: Tx, ctx: CallerContext, jobId: string): Promise<{ id: string }> {
    const existing = await tx.query.chatThreads.findFirst({
      where: eq(chatThreads.jobId, jobId),
    });
    if (existing) return { id: existing.id };
    const id = uuidv7();
    const [row] = await tx
      .insert(chatThreads)
      .values({ id, tenantId: ctx.tenantId, jobId })
      .onConflictDoNothing({ target: [chatThreads.tenantId, chatThreads.jobId] })
      .returning({ id: chatThreads.id });
    if (row) return { id: row.id };
    // Lost the create race — re-read.
    const racer = await tx.query.chatThreads.findFirst({ where: eq(chatThreads.jobId, jobId) });
    if (!racer) throw new Error('chat_threads create race had no winner');
    return { id: racer.id };
  }

  private async loadParticipant(
    tx: Tx,
    ctx: CallerContext,
    jobId: string,
  ): Promise<ParticipantInfo> {
    const job = await tx.query.jobs.findFirst({
      where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
      columns: { assignedDriverId: true },
    });
    if (!job) {
      return { jobExists: false, isDriverOnJob: false, assignedDriverId: null };
    }

    let isDriverOnJob = false;
    if (ctx.role === ROLES.DRIVER) {
      const myDriver = await tx.query.drivers.findFirst({
        where: and(eq(drivers.userId, ctx.userId), isNull(drivers.deletedAt)),
        columns: { id: true },
      });
      isDriverOnJob = !!myDriver && myDriver.id === job.assignedDriverId;
    }

    return {
      jobExists: true,
      isDriverOnJob,
      assignedDriverId: job.assignedDriverId,
    };
  }

  /**
   * Drivers may only access threads for jobs assigned to them. Dispatchers,
   * admins, and managers may access any thread in their tenant — RLS already
   * provides the tenant boundary.
   */
  private assertParticipant(ctx: CallerContext, p: ParticipantInfo): void {
    if (ctx.role === ROLES.DRIVER) {
      if (!p.isDriverOnJob) {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'Driver is not assigned to this job',
        });
      }
      return;
    }
    if (
      ctx.role === ROLES.DISPATCHER ||
      ctx.role === ROLES.ADMIN ||
      ctx.role === ROLES.MANAGER ||
      ctx.role === ROLES.OWNER
    ) {
      return;
    }
    throw new ForbiddenException({
      code: ERROR_CODES.FORBIDDEN,
      message: 'Role is not permitted to access chat',
    });
  }

  private deriveAuthorRole(role: Role | null): ChatAuthorRole {
    if (role === ROLES.DRIVER) return 'driver';
    if (role === ROLES.DISPATCHER) return 'dispatcher';
    if (role === ROLES.MANAGER) return 'manager';
    // owner / admin both record as 'admin' so the table enum stays small.
    return 'admin';
  }

  private kindToAttachment(kind: ChatMessageKind): ChatAttachmentType {
    if (kind === 'voice') return 'voice_memo';
    if (kind === 'photo') return 'photo';
    if (kind === 'video') return 'video';
    // text and quick_reply both store as 'none' — quick_reply is a UI
    // presentation of text, not a separate storage form.
    return 'none';
  }

  private async enqueueNotification(
    ctx: CallerContext,
    jobId: string,
    msg: ChatMessageDto,
  ): Promise<void> {
    // The notification provider interface supports the 'push' channel; the
    // platform-wide registry resolves to the stub provider in dev. The 'to'
    // field is best-effort: we route by author. Driver-authored messages go
    // to the dispatcher pool (no targeted phone number), dispatcher messages
    // go to the assigned driver's phone if we have one. The stub provider
    // accepts any 'to'; Twilio will reject empty 'to' and that's the right
    // failure to surface in prod.
    const preview =
      msg.body && msg.body.length > 80 ? `${msg.body.slice(0, 77)}…` : (msg.body ?? '[attachment]');
    const body = `New message on job ${jobId.slice(0, 8)}: ${preview}`;

    if (msg.sender === 'driver') {
      // Driver→dispatcher. We don't have a targeted dispatcher phone yet;
      // the stub provider sinks it and the future dispatcher push channel
      // will look up subscribers by tenant+role.
      await this.notifications.sendSms({
        tenantId: ctx.tenantId,
        to: `tenant:${ctx.tenantId}:role:dispatcher`,
        body,
        clientReference: `chat:${msg.id}`,
      });
      return;
    }

    // Dispatcher/admin/manager→driver. Look up the assigned driver's phone.
    const phone = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
        columns: { assignedDriverId: true },
      });
      if (!job?.assignedDriverId) return null;
      const d = await tx.query.drivers.findFirst({
        where: and(eq(drivers.id, job.assignedDriverId), isNull(drivers.deletedAt)),
        columns: { phone: true, userId: true },
      });
      if (!d) return null;
      if (d.phone) return d.phone;
      if (!d.userId) return null;
      const u = await tx.query.users.findFirst({
        where: eq(users.id, d.userId),
        columns: { phone: true },
      });
      return u?.phone ?? null;
    });

    await this.notifications.sendSms({
      tenantId: ctx.tenantId,
      to: phone ?? '',
      body,
      clientReference: `chat:${msg.id}`,
    });
  }

  private toTenantCtx(ctx: CallerContext): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}

// ---------- DTO mapping (delegates to chat.testables for the pure logic) ----------

function rowToDto(
  row: {
    id: string;
    body: string | null;
    attachmentUrl: string | null;
    attachmentType: ChatAttachmentType;
    authorRole: ChatAuthorRole;
    createdAt: Date;
    deliveredAt: Date | null;
    readAt: Date | null;
  },
  jobId: string,
): ChatMessageDto {
  return {
    id: row.id,
    jobId,
    sender: ChatServiceTestables.senderFromAuthorRole(row.authorRole),
    kind: ChatServiceTestables.kindFromAttachment(row.attachmentType),
    body: row.body,
    attachmentUrl: row.attachmentUrl,
    durationSeconds: null,
    createdAt: row.createdAt.toISOString(),
    deliveryState: ChatServiceTestables.deliveryStateFromRow(row),
  };
}

const encodeCursor = ChatServiceTestables.encodeCursor;
const decodeCursor = ChatServiceTestables.decodeCursor;
