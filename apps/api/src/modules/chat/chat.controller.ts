/**
 * ChatController — HTTP surface for /dispatch/chat/* (Session 6.2).
 *
 * Path layout matches the iOS client's expectations (see
 * apps/driver-ios/Packages/Core/Sources/Core/Networking/Endpoints.swift):
 *   POST   /dispatch/chat/threads/:jobId/messages
 *   GET    /dispatch/chat/threads/:jobId/messages
 *   PATCH  /dispatch/chat/messages/:messageId/read
 *   POST   /dispatch/chat/messages/:messageId/attachment-url
 *
 * Role gate admits DRIVER/DISPATCHER/ADMIN/MANAGER/OWNER. Per-thread
 * participant checks happen in ChatService so any future internal caller
 * can't accidentally widen access.
 */
import { Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  type AttachmentUrlRequestPayload,
  type AttachmentUrlResponse,
  type ChatMessageDto,
  type ListChatMessagesQuery,
  type ListChatMessagesResponse,
  ROLES,
  type Role,
  type SendChatMessagePayload,
  attachmentUrlRequestSchema,
  listChatMessagesQuerySchema,
  sendChatMessageSchema,
} from '@towdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ChatService } from './chat.service.js';

const jobIdSchema = z.object({ jobId: z.string().uuid() });
const messageIdSchema = z.object({ messageId: z.string().uuid() });

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@UseGuards(RolesGuard)
@Controller('dispatch/chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('threads/:jobId/messages')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async send(
    @ZodParam(jobIdSchema) params: { jobId: string },
    @ZodBody(sendChatMessageSchema) body: SendChatMessagePayload,
    @Req() req: FastifyRequest,
  ): Promise<ChatMessageDto> {
    return this.chat.send(this.callerCtx(req), params.jobId, body);
  }

  @Get('threads/:jobId/messages')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async list(
    @ZodParam(jobIdSchema) params: { jobId: string },
    @ZodQuery(listChatMessagesQuerySchema) query: ListChatMessagesQuery,
    @Req() req: FastifyRequest,
  ): Promise<ListChatMessagesResponse> {
    return this.chat.list(this.callerCtx(req), params.jobId, query);
  }

  @Patch('messages/:messageId/read')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async markRead(
    @ZodParam(messageIdSchema) params: { messageId: string },
    @Req() req: FastifyRequest,
  ): Promise<ChatMessageDto> {
    return this.chat.markRead(this.callerCtx(req), params.messageId);
  }

  @Post('messages/:messageId/attachment-url')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async attachmentUrl(
    @ZodParam(messageIdSchema) params: { messageId: string },
    @ZodBody(attachmentUrlRequestSchema) body: AttachmentUrlRequestPayload,
    @Req() req: FastifyRequest,
  ): Promise<AttachmentUrlResponse> {
    return this.chat.mintAttachmentUrl(this.callerCtx(req), params.messageId, body);
  }

  private callerCtx(req: FastifyRequest): CallerContext {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      role: c.role as Role | null,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }
}
