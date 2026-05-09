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
import { ERROR_CODES, type ProblemDetails } from '@towcommand/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    const requestId = req.requestContext?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let problem: ProblemDetails = {
      type: `https://errors.towcommand.com/${ERROR_CODES.INTERNAL_ERROR}`,
      title: 'Internal Server Error',
      status,
      code: ERROR_CODES.INTERNAL_ERROR,
      ...(requestId ? { requestId } : {}),
    };

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      problem = {
        type: `https://errors.towcommand.com/${ERROR_CODES.VALIDATION_FAILED}`,
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
        type: `https://errors.towcommand.com/${code}`,
        title: payload.message ?? exception.message ?? 'Request failed',
        status,
        code,
        ...(payload.errors ? { errors: payload.errors } : {}),
        ...(payload.message ? { detail: payload.message } : {}),
        ...(requestId ? { requestId } : {}),
      };
    } else if (exception instanceof Error) {
      this.logger.error(
        { err: exception, requestId, path: req.url, method: req.method },
        'Unhandled exception',
      );
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
