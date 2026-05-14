import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateUserPayload,
  ROLES,
  type UpdateUserPayload,
  type UserDto,
  createUserSchema,
  updateUserSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersService } from './users.service.js';

const userIdSchema = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(@Req() req: FastifyRequest): Promise<UserDto[]> {
    return this.users.list(this.callerCtx(req));
  }

  @Get(':id')
  async get(
    @ZodParam(userIdSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<UserDto> {
    return this.users.get(this.callerCtx(req), params.id);
  }

  @Post()
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async create(
    @ZodBody(createUserSchema) body: CreateUserPayload,
    @Req() req: FastifyRequest,
  ): Promise<UserDto> {
    return this.users.create(this.callerCtx(req), body);
  }

  @Patch(':id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async update(
    @ZodParam(userIdSchema) params: { id: string },
    @ZodBody(updateUserSchema) body: UpdateUserPayload,
    @Req() req: FastifyRequest,
  ): Promise<UserDto> {
    return this.users.update(this.callerCtx(req), params.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async deactivate(
    @ZodParam(userIdSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.users.deactivate(this.callerCtx(req), params.id);
  }

  private callerCtx(req: FastifyRequest): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  } {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }
}
