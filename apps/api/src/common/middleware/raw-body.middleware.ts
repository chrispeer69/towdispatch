/**
 * Raw-body capture for the Stripe webhook (and any other route that needs
 * to verify a signature against the bytes-as-sent).
 *
 * Strategy: register a content-type parser that ALWAYS captures the raw
 * UTF-8 body for application/json on the configured paths, then JSON.parses
 * it for normal handlers. We attach `req.rawBody = string` on those URLs
 * only — every other route is unaffected.
 *
 * Stripe's signature verification computes HMAC-SHA256 over the raw body,
 * so any reformatting (trimming, whitespace normalization) by the JSON
 * parser would invalidate the signature.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/**
 * Register a raw-body-aware JSON parser. Replaces Fastify's default
 * application/json parser so every JSON body is captured into rawBody.
 *
 * Idempotent — if a parser is already registered for application/json (Nest
 * registers one during app.init()), we remove it first. Safe to call from
 * either main.ts (before init) or test bootstraps (after).
 */
export function registerRawBodyJsonParser(fastify: FastifyInstance): void {
  if (fastify.hasContentTypeParser('application/json')) {
    fastify.removeContentTypeParser('application/json');
  }
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req: FastifyRequest, body: string | Buffer, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      req.rawBody = raw;
      if (raw.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
}
