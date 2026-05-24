/**
 * Global exception filter. Renders RFC 9457 problem+json for every error.
 * Includes the request_id so support tickets are immediately traceable.
 *
 * Zod errors surface as 400 with structured `errors` array. NestJS
 * HttpExceptions surface with their status. Everything else is 500.
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ERROR_CODES, type ProblemDetails } from '@ustowdispatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { redactPii } from '../observability/redact-pii.js';
import type { ConfigService } from '../../config/config.service.js';
import type { SentryService } from '../observability/sentry.service.js';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger: Logger;
  /** Base URI for RFC 9457 problem-type identifiers; no trailing slash. */
  private readonly problemTypeBase: string;

  constructor(
    config: ConfigService,
    private readonly sentry?: SentryService,
  ) {
    this.logger = config.logger;
    this.problemTypeBase = config.problemTypeBase;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    const requestId = req.requestContext?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let problem: ProblemDetails = {
      type: `${this.problemTypeBase}/${ERROR_CODES.INTERNAL_ERROR}`,
      title: 'Internal Server Error',
      status,
      code: ERROR_CODES.INTERNAL_ERROR,
      ...(requestId ? { requestId } : {}),
    };

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      problem = {
        type: `${this.problemTypeBase}/${ERROR_CODES.VALIDATION_FAILED}`,
        title: 'Validation Failed',
        status,
        code: ERROR_CODES.VALIDATION_FAILED,
        errors: exception.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
        ...(requestId ? { requestId } : {}),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const payload =
        typeof r === 'string'
          ? { message: r }
          : (r as { code?: string; message?: string; errors?: ProblemDetails['errors'] });
      const code = payload.code ?? statusToCode(status);
      problem = {
        type: `${this.problemTypeBase}/${code}`,
        title: payload.message ?? exception.message ?? 'Request failed',
        status,
        code,
        ...(payload.errors ? { errors: payload.errors } : {}),
        ...(payload.message ? { detail: payload.message } : {}),
        ...(requestId ? { requestId } : {}),
      };
    } else if (exception instanceof Error) {
      // Scrub free-text PII (email/phone/SSN) from the LOG line. The pino
      // logger already redacts known structured keys; this catches PII that
      // ends up inline in an error message (e.g. a Postgres constraint error
      // echoing a value). Sentry receives the ORIGINAL exception below, so
      // its own beforeSend scrubbing + stack grouping are unaffected.
      this.logger.error(
        {
          errName: exception.name,
          errMessage: redactPii(exception.message),
          errStack: redactPii(exception.stack),
          requestId,
          path: req.url,
          method: req.method,
        },
        'Unhandled exception',
      );
      this.sentry?.captureException(exception, {
        requestId,
        tenantId: req.requestContext?.tenantId,
        userId: req.requestContext?.userId,
      });
    } else {
      this.logger.error({ exception, requestId }, 'Unhandled non-Error exception');
    }

    res
      .status(status)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .send(problem);
  }
}

function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return ERROR_CODES.BAD_REQUEST;
    case 401:
      return ERROR_CODES.UNAUTHORIZED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 409:
      return ERROR_CODES.CONFLICT;
    case 429:
      return ERROR_CODES.RATE_LIMITED;
    case 503:
      return ERROR_CODES.SERVICE_UNAVAILABLE;
    default:
      return ERROR_CODES.INTERNAL_ERROR;
  }
}
