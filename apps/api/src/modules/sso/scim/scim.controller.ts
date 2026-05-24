/**
 * ScimController — RFC 7644 Users + Groups, mounted at /scim/v2.
 *
 * @Public() (the global JwtAuthGuard skips) + ScimAuthGuard (bearer token →
 * tenant). Every response is application/scim+json. Unsupported filters are
 * logged and degraded to an unfiltered page rather than 400, per the SCIM
 * robustness guidance.
 */
import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ERROR_CODES,
  SCIM_LIST_RESPONSE_SCHEMA,
  type ScimGroupResource,
  type ScimListResponse,
  type ScimUserResource,
  scimGroupInputSchema,
  scimPatchOpSchema,
  scimUserInputSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../../common/decorators/public.decorator.js';
import { ConfigService } from '../../../config/config.service.js';
import { ScimAuthGuard } from './scim-auth.guard.js';
import { parseScimFilter } from './scim-filter.js';
import { type ScimContext, ScimNotFoundError, ScimService } from './scim.service.js';

const idParam = z.object({ id: z.string().min(1) });
const listQuery = z.object({
  filter: z.string().optional(),
  startIndex: z.coerce.number().int().min(1).optional(),
  count: z.coerce.number().int().min(0).max(200).optional(),
});

@Public()
@UseGuards(ScimAuthGuard)
@Controller('scim/v2')
export class ScimController {
  constructor(
    private readonly scim: ScimService,
    private readonly config: ConfigService,
  ) {}

  private ctx(req: FastifyRequest): ScimContext {
    const c = req.scimContext;
    if (!c) {
      // Guard guarantees this; defensive only.
      throw new NotFoundException({
        code: ERROR_CODES.SCIM_TOKEN_INVALID,
        message: 'No SCIM context',
      });
    }
    return c;
  }

  private page(q: z.infer<typeof listQuery>): { startIndex: number; count: number } {
    return { startIndex: q.startIndex ?? 1, count: q.count ?? 100 };
  }

  private list(
    startIndex: number,
    total: number,
    resources: (ScimUserResource | ScimGroupResource)[],
  ): ScimListResponse {
    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      // totalResults is the count of ALL matches (not this page) so IdPs
      // paginate correctly; itemsPerPage is the page size.
      totalResults: total,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  // ------------------------------------------------------------ Users
  @Get('Users')
  @Header('Content-Type', 'application/scim+json')
  async listUsers(@Req() req: FastifyRequest, @Query() query: unknown): Promise<ScimListResponse> {
    const q = listQuery.parse(query);
    const parsed = parseScimFilter(q.filter);
    if (!parsed.supported) {
      this.config.logger.warn(
        { filter: q.filter, reason: parsed.reason },
        'scim: unsupported filter',
      );
    }
    const clauses = parsed.supported ? parsed.clauses : [];
    const { total, resources } = await this.scim.listUsers(this.ctx(req), clauses, this.page(q));
    return this.list(this.page(q).startIndex, total, resources);
  }

  @Get('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  async getUser(@Req() req: FastifyRequest, @Param() params: unknown): Promise<ScimUserResource> {
    const { id } = idParam.parse(params);
    return this.scimUserOr404(() => this.scim.getUser(this.ctx(req), id));
  }

  @Post('Users')
  @HttpCode(HttpStatus.CREATED)
  @Header('Content-Type', 'application/scim+json')
  async createUser(@Req() req: FastifyRequest): Promise<ScimUserResource> {
    const body = scimUserInputSchema.parse(req.body);
    return this.scim.createUser(this.ctx(req), body);
  }

  @Put('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  async replaceUser(
    @Req() req: FastifyRequest,
    @Param() params: unknown,
  ): Promise<ScimUserResource> {
    const { id } = idParam.parse(params);
    const body = scimUserInputSchema.parse(req.body);
    return this.scimUserOr404(() => this.scim.replaceUser(this.ctx(req), id, body));
  }

  @Patch('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  async patchUser(@Req() req: FastifyRequest, @Param() params: unknown): Promise<ScimUserResource> {
    const { id } = idParam.parse(params);
    const body = scimPatchOpSchema.parse(req.body);
    return this.scimUserOr404(() => this.scim.patchUser(this.ctx(req), id, body));
  }

  @Delete('Users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(@Req() req: FastifyRequest, @Param() params: unknown): Promise<void> {
    const { id } = idParam.parse(params);
    try {
      await this.scim.deleteUser(this.ctx(req), id);
    } catch (err) {
      throw this.map(err);
    }
  }

  // ------------------------------------------------------------ Groups
  @Get('Groups')
  @Header('Content-Type', 'application/scim+json')
  async listGroups(@Req() req: FastifyRequest, @Query() query: unknown): Promise<ScimListResponse> {
    const q = listQuery.parse(query);
    const parsed = parseScimFilter(q.filter);
    if (!parsed.supported) {
      this.config.logger.warn(
        { filter: q.filter, reason: parsed.reason },
        'scim: unsupported group filter',
      );
    }
    const clauses = parsed.supported ? parsed.clauses : [];
    const { total, resources } = await this.scim.listGroups(this.ctx(req), clauses, this.page(q));
    return this.list(this.page(q).startIndex, total, resources);
  }

  @Get('Groups/:id')
  @Header('Content-Type', 'application/scim+json')
  async getGroup(@Req() req: FastifyRequest, @Param() params: unknown): Promise<ScimGroupResource> {
    const { id } = idParam.parse(params);
    return this.scimGroupOr404(() => this.scim.getGroup(this.ctx(req), id));
  }

  @Post('Groups')
  @HttpCode(HttpStatus.CREATED)
  @Header('Content-Type', 'application/scim+json')
  async createGroup(@Req() req: FastifyRequest): Promise<ScimGroupResource> {
    const body = scimGroupInputSchema.parse(req.body);
    return this.scim.createGroup(this.ctx(req), body);
  }

  @Put('Groups/:id')
  @Header('Content-Type', 'application/scim+json')
  async replaceGroup(
    @Req() req: FastifyRequest,
    @Param() params: unknown,
  ): Promise<ScimGroupResource> {
    const { id } = idParam.parse(params);
    const body = scimGroupInputSchema.parse(req.body);
    return this.scimGroupOr404(() => this.scim.replaceGroup(this.ctx(req), id, body));
  }

  @Delete('Groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGroup(@Req() req: FastifyRequest, @Param() params: unknown): Promise<void> {
    const { id } = idParam.parse(params);
    try {
      await this.scim.deleteGroup(this.ctx(req), id);
    } catch (err) {
      throw this.map(err);
    }
  }

  // ------------------------------------------------------------ helpers
  private async scimUserOr404(fn: () => Promise<ScimUserResource>): Promise<ScimUserResource> {
    try {
      return await fn();
    } catch (err) {
      throw this.map(err);
    }
  }

  private async scimGroupOr404(fn: () => Promise<ScimGroupResource>): Promise<ScimGroupResource> {
    try {
      return await fn();
    } catch (err) {
      throw this.map(err);
    }
  }

  private map(err: unknown): unknown {
    if (err instanceof ScimNotFoundError) {
      return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
    }
    return err;
  }
}
