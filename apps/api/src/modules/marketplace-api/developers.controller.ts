/**
 * /developers/* (Session 46) — the developer-portal API.
 *
 * Signup / verify-email / login are @Public (no developer session yet); every
 * other route is DeveloperAuthGuard-gated. All behind MARKETPLACE_API_ENABLED.
 * Developers are a global auth realm — these routes never touch tenant context.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateMarketplaceAppPayload,
  type DeveloperAccountDto,
  type DeveloperLoginPayload,
  type DeveloperSession,
  type DeveloperSignupPayload,
  type DeveloperSignupResult,
  type MarketplaceAppCredentials,
  type MarketplaceAppDto,
  type MarketplaceAppMetrics,
  type UpdateMarketplaceAppPayload,
  createMarketplaceAppSchema,
  developerLoginSchema,
  developerSignupSchema,
  developerVerifyEmailSchema,
  updateMarketplaceAppSchema,
} from '@ustowdispatch/shared';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { CurrentDeveloper } from './current-developer.decorator.js';
import { type DeveloperAuthContext, DeveloperAuthGuard } from './developer-auth.guard.js';
import { DevelopersService } from './developers.service.js';
import { MarketplaceEnabledGuard } from './marketplace-enabled.guard.js';

@UseGuards(MarketplaceEnabledGuard)
@Controller('developers')
export class DevelopersController {
  constructor(private readonly developers: DevelopersService) {}

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(
    @ZodBody(developerSignupSchema) body: DeveloperSignupPayload,
  ): Promise<DeveloperSignupResult> {
    return this.developers.signup(body);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @ZodBody(developerVerifyEmailSchema) body: { token: string },
  ): Promise<{ verified: true }> {
    return this.developers.verifyEmail(body.token);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @ZodBody(developerLoginSchema) body: DeveloperLoginPayload,
  ): Promise<DeveloperSession> {
    return this.developers.login(body.ownerUserEmail, body.password);
  }

  // ---- authenticated developer-portal routes ----------------------------

  @Get('me')
  @UseGuards(DeveloperAuthGuard)
  async me(@CurrentDeveloper() dev: DeveloperAuthContext): Promise<DeveloperAccountDto> {
    return this.developers.getAccount(dev.developerId);
  }

  @Post('apps')
  @UseGuards(DeveloperAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createApp(
    @CurrentDeveloper() dev: DeveloperAuthContext,
    @ZodBody(createMarketplaceAppSchema) body: CreateMarketplaceAppPayload,
  ): Promise<MarketplaceAppCredentials> {
    return this.developers.createApp(dev.developerId, body);
  }

  @Get('apps')
  @UseGuards(DeveloperAuthGuard)
  async listApps(@CurrentDeveloper() dev: DeveloperAuthContext): Promise<MarketplaceAppDto[]> {
    return this.developers.listApps(dev.developerId);
  }

  @Get('apps/:id')
  @UseGuards(DeveloperAuthGuard)
  async getApp(
    @CurrentDeveloper() dev: DeveloperAuthContext,
    @Param('id') id: string,
  ): Promise<MarketplaceAppDto> {
    return this.developers.getApp(dev.developerId, id);
  }

  @Patch('apps/:id')
  @UseGuards(DeveloperAuthGuard)
  async updateApp(
    @CurrentDeveloper() dev: DeveloperAuthContext,
    @Param('id') id: string,
    @ZodBody(updateMarketplaceAppSchema) body: UpdateMarketplaceAppPayload,
  ): Promise<MarketplaceAppDto> {
    return this.developers.updateApp(dev.developerId, id, body);
  }

  @Delete('apps/:id')
  @UseGuards(DeveloperAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteApp(
    @CurrentDeveloper() dev: DeveloperAuthContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.developers.deleteApp(dev.developerId, id);
  }

  @Post('apps/:id/submit')
  @UseGuards(DeveloperAuthGuard)
  async submitApp(
    @CurrentDeveloper() dev: DeveloperAuthContext,
    @Param('id') id: string,
  ): Promise<MarketplaceAppDto> {
    return this.developers.submitForReview(dev.developerId, id);
  }

  @Get('apps/:id/metrics')
  @UseGuards(DeveloperAuthGuard)
  async metrics(
    @CurrentDeveloper() dev: DeveloperAuthContext,
    @Param('id') id: string,
  ): Promise<MarketplaceAppMetrics> {
    return this.developers.metrics(dev.developerId, id);
  }
}
