import type { RequestContext } from '@towcommand/shared';
/**
 * Per-request context attached to every Fastify request.
 *
 * We register this as a Fastify `onRequest` hook (see registerRequestContext)
 * rather than a NestMiddleware because Nest middleware on the Fastify adapter
 * runs against the raw IncomingMessage, and properties set there don't make it
 * onto the FastifyRequest the controllers and guards see. The hook gets us
 * a single live object that both the auth guard and the route handlers share.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { uuidv7 } from 'uuidv7';

export interface MutableRequestContext extends RequestContext {
  requestId: RequestContext['requestId'];
}

declare module 'fastify' {
  interface FastifyRequest {
    requestContext: MutableRequestContext;
  }
}

const REQUEST_ID_RX = /^[a-zA-Z0-9_-]{6,64}$/;

export function buildRequestContext(req: FastifyRequest): MutableRequestContext {
  const incoming = req.headers['x-request-id'];
  const incomingId = typeof incoming === 'string' ? incoming : undefined;
  const requestId = (
    incomingId && REQUEST_ID_RX.test(incomingId) ? incomingId : uuidv7()
  ) as RequestContext['requestId'];

  const xff = req.headers['x-forwarded-for'];
  const xffStr = Array.isArray(xff) ? xff[0] : xff;
  const ip = xffStr?.split(',')[0]?.trim() ?? req.ip ?? null;
  const userAgent =
    typeof req.headers['user-agent'] === 'string' ? (req.headers['user-agent'] as string) : null;

  return {
    requestId,
    tenantId: null,
    userId: null,
    role: null,
    ipAddress: ip,
    userAgent,
  };
}

/**
 * Attaches a fresh request context to every incoming Fastify request and
 * mirrors the request id back as `x-request-id`. Idempotent — safe to call
 * multiple times during boot (the hook is registered only once per call).
 */
export function registerRequestContext(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    req.requestContext = buildRequestContext(req);
    reply.header('x-request-id', req.requestContext.requestId);
  });
}
