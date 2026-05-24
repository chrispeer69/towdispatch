/**
 * /marketplace/apps (Session 46) — the PUBLIC app directory. Unauthenticated,
 * paginated, filterable by category and free-text query. Only `listed` apps
 * appear. Behind MARKETPLACE_API_ENABLED (503 when off).
 */
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  type DirectoryPage,
  type DirectoryQuery,
  type MarketplaceAppPublicDto,
  directoryQuerySchema,
} from '@ustowdispatch/shared';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodQuery } from '../../common/decorators/zod.decorator.js';
import { DirectoryService } from './directory.service.js';
import { MarketplaceEnabledGuard } from './marketplace-enabled.guard.js';

@Public()
@UseGuards(MarketplaceEnabledGuard)
@Controller('marketplace/apps')
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  async list(@ZodQuery(directoryQuerySchema) query: DirectoryQuery): Promise<DirectoryPage> {
    return this.directory.list(query);
  }

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string): Promise<MarketplaceAppPublicDto> {
    return this.directory.getBySlug(slug);
  }
}
