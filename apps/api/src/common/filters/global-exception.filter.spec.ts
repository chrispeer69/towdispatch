/**
 * GlobalExceptionFilter — unit coverage on the RFC 9457 problem rendering, with
 * focus on R-10: the problem-type `type` URI is built from PROBLEM_TYPE_BASE
 * (via ConfigService) rather than a hardcoded domain.
 *
 * Drives the real ConfigService getter (trailing-slash strip + URL validation).
 * ConfigService reads process.env at construction, so each case mutates a
 * minimal env and restores it; loadConfig() process.exit(1)s on invalid env,
 * hence the required keys are always set.
 */
import type { ArgumentsHost } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { ERROR_CODES, type ProblemDetails } from '@ustowdispatch/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ZodError, z } from 'zod';
import { ConfigService } from '../../config/config.service.js';
import { GlobalExceptionFilter } from './global-exception.filter.js';

const REQUIRED = {
  DATABASE_URL: 'postgres://u:p@db.local:5432/app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(40),
  NODE_ENV: 'test',
};

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = process.env;
  process.env = { ...REQUIRED } as NodeJS.ProcessEnv;
});

afterEach(() => {
  process.env = saved;
});

/** Captures the problem payload a filter sends through a Fastify-shaped reply. */
function runFilter(exception: unknown): ProblemDetails {
  const filter = new GlobalExceptionFilter(new ConfigService());
  let sent: ProblemDetails | undefined;
  const reply = {
    status() {
      return this;
    },
    header() {
      return this;
    },
    send(payload: ProblemDetails) {
      sent = payload;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ url: '/x', method: 'GET', requestContext: undefined }),
    }),
  } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  if (!sent) throw new Error('filter did not send a problem payload');
  return sent;
}

describe('GlobalExceptionFilter problem-type URN (R-10)', () => {
  it('defaults the type base to the .cloud prod domain', () => {
    const problem = runFilter(new Error('boom'));
    expect(problem.type).toBe(`https://errors.ustowdispatch.cloud/${ERROR_CODES.INTERNAL_ERROR}`);
    expect(problem.code).toBe(ERROR_CODES.INTERNAL_ERROR);
  });

  it('honors a PROBLEM_TYPE_BASE override on validation errors', () => {
    process.env.PROBLEM_TYPE_BASE = 'https://problems.example.test';
    let zerr: ZodError;
    try {
      z.object({ a: z.string() }).parse({});
      throw new Error('expected parse to throw');
    } catch (e) {
      zerr = e as ZodError;
    }
    const problem = runFilter(zerr);
    expect(problem.type).toBe(`https://problems.example.test/${ERROR_CODES.VALIDATION_FAILED}`);
    expect(problem.status).toBe(400);
  });

  it('strips a trailing slash so the URN has no doubled separator', () => {
    process.env.PROBLEM_TYPE_BASE = 'https://errors.ustowdispatch.cloud/';
    const exception = new HttpException({ code: ERROR_CODES.NOT_FOUND, message: 'nope' }, 404);
    const problem = runFilter(exception);
    expect(problem.type).toBe(`https://errors.ustowdispatch.cloud/${ERROR_CODES.NOT_FOUND}`);
    expect(problem.type).not.toContain('cloud//');
  });
});
