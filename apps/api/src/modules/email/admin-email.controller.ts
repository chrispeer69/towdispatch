/**
 * POST /admin/email/test — diagnostic email sender.
 *
 * Guarded by a static bearer token from EMAIL_TEST_TOKEN (NOT JWT). Returns
 * the full SendGrid response (status code, x-message-id) or the full error
 * body so the operator can see exactly what the provider said. Stays in the
 * codebase as an ongoing diagnostics tool; rotate EMAIL_TEST_TOKEN if it
 * leaks.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { ConfigService } from '../../config/config.service.js';
import { EmailService, type SendDiagnostic } from './email.service.js';

interface TestEmailBody {
  to?: unknown;
}

// Standard HTML5 email regex which avoids catastrophic backtracking
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

@Controller('admin/email')
export class AdminEmailController {
  private readonly log = new Logger(AdminEmailController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  @Public()
  @Throttle({ burst: { limit: 10, ttl: seconds(60) } })
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async test(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: TestEmailBody,
  ): Promise<SendDiagnostic & { from: string }> {
    this.assertAuthorized(authHeader);

    const to = typeof body?.to === 'string' ? body.to.trim() : '';
    if (!to || !EMAIL_REGEX.test(to)) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'body.to must be a valid email address',
      });
    }

    this.log.log({ msg: 'admin email test invoked', to });
    const result = await this.email.sendTestEmail(to);
    this.log.log({ msg: 'admin email test result', to, result });
    if (!result.ok) {
      // 502 — provider rejected. Return the body so the operator can act.
      throw new ServiceUnavailableException({
        code: 'EMAIL_SEND_FAILED',
        message: result.errorMessage ?? 'email send failed',
        diagnostic: { ...result, from: this.config.email.from },
      });
    }
    return { ...result, from: this.config.email.from };
  }

  private assertAuthorized(authHeader: string | undefined): void {
    const configured = this.config.email.testToken;
    if (!configured) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'EMAIL_TEST_TOKEN is not configured on this environment',
      });
    }
    const supplied = parseBearer(authHeader);
    if (!supplied || !timingSafeEqual(supplied, configured)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Invalid or missing bearer token',
      });
    }
  }
}

function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(/\s+/, 2);
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return value;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
