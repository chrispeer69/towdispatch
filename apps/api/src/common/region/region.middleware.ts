/**
 * Region Fastify hooks (Session 44). Registered in main.ts right after
 * registerRequestContext — same pattern as the request-context hook (we use a
 * Fastify onRequest hook, not Nest middleware, because the hook runs before
 * routing and can short-circuit a blocked write with custom headers).
 *
 * onRequest:  on a SECONDARY, refuse tenant writes with 503 + Retry-After +
 *             Location (→ primary). Always stamp the response with the serving
 *             region so clients/operators can see which region answered.
 * onResponse: on the PRIMARY, when a write-intent request succeeded, stamp the
 *             region's lastWriteTs marker.
 *
 * Note: auth/role is resolved later (Nest guard phase), so this hook is
 * deliberately role-independent — the block rule is method + path only.
 */
import { ERROR_CODES, PREFERRED_REGION_HEADER, regionIdSchema } from '@ustowdispatch/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import type { ConfigService } from '../../config/config.service.js';
import type { RegionContextService } from './region-context.service.js';
import {
  WRITE_REDIRECT_RETRY_AFTER_SECONDS,
  buildPrimaryLocation,
  evaluateWriteGuard,
} from './write-guard.logic.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RegionGuardDeps {
  config: ConfigService;
  regionContext: RegionContextService;
  logger: Logger;
}

export function registerRegionGuards(fastify: FastifyInstance, deps: RegionGuardDeps): void {
  const region = deps.config.region;

  fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Always advertise the serving region (cheap, aids cross-region debugging).
    reply.header('x-region-id', region.id);
    reply.header('x-region-role', region.role);

    // X-Preferred-Region is accepted and acknowledged; actually routing on it
    // is edge/DNS work (owner-side) and out of scope this session. We validate
    // and echo only.
    const pref = req.headers[PREFERRED_REGION_HEADER];
    if (typeof pref === 'string' && regionIdSchema.safeParse(pref).success) {
      reply.header('x-preferred-region-ack', pref);
    }

    const decision = evaluateWriteGuard({
      method: req.method,
      url: req.url,
      isPrimary: region.isPrimary,
    });
    if (!decision.blocked) return;

    const location = buildPrimaryLocation(region.peerOrigin, req.url);
    reply.header('retry-after', String(WRITE_REDIRECT_RETRY_AFTER_SECONDS));
    if (location) reply.header('location', location);
    deps.logger.warn(
      { method: req.method, path: req.url, regionId: region.id, location },
      'region write-guard: refused tenant write on secondary',
    );
    await reply.code(503).send({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: 'Writes are not accepted by the secondary region. Retry against the primary.',
      region: { id: region.id, role: region.role },
      primary: location,
    });
  });

  fastify.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    // Mark a successful write-intent request handled by the primary. A 4xx/5xx
    // is not counted — it didn't (reliably) commit anything.
    if (region.isPrimary && WRITE_METHODS.has(req.method.toUpperCase()) && reply.statusCode < 400) {
      deps.regionContext.markWrite();
    }
  });
}
