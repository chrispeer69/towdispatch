/**
 * Body parsers for the Enterprise SSO surface (Session 38).
 *
 *   * application/x-www-form-urlencoded — the SAML IdP form-POSTs the
 *     SAMLResponse + RelayState to the ACS. Fastify has no urlencoded parser
 *     by default (and we don't pull in @fastify/formbody for one route), so
 *     we register a minimal one that yields a flat object.
 *   * application/scim+json — IdPs send SCIM bodies with this content type;
 *     without a parser @ZodBody sees nothing. Treat it as JSON.
 *
 * Idempotent: guarded by hasContentTypeParser so repeated boots (tests) are
 * safe.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

export function registerSsoBodyParsers(fastify: FastifyInstance): void {
  if (!fastify.hasContentTypeParser('application/x-www-form-urlencoded')) {
    fastify.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req: FastifyRequest, body: string | Buffer, done) => {
        const raw = typeof body === 'string' ? body : body.toString('utf8');
        try {
          const params = new URLSearchParams(raw);
          const obj: Record<string, string> = {};
          for (const [k, v] of params) obj[k] = v;
          done(null, obj);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );
  }

  if (!fastify.hasContentTypeParser('application/scim+json')) {
    fastify.addContentTypeParser(
      'application/scim+json',
      { parseAs: 'string' },
      (_req: FastifyRequest, body: string | Buffer, done) => {
        const raw = typeof body === 'string' ? body : body.toString('utf8');
        if (raw.length === 0) {
          done(null, undefined);
          return;
        }
        try {
          done(null, JSON.parse(raw) as unknown);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );
  }
}
