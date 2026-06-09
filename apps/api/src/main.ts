/**
 * API entrypoint. Boots NestJS on the Fastify adapter.
 *
 * Why Fastify: ~2× the throughput of Express, schema-driven serialization,
 * and a request lifecycle that matches our request-scoped tenant context model.
 *
 * The bootstrap intentionally fails loud: a missing env var or unreachable DB
 * is not a "warn and continue" condition. Better to crash and let the
 * orchestrator restart us than to start in a half-broken state.
 */
import 'reflect-metadata';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { registerRawBodyJsonParser } from './common/middleware/raw-body.middleware.js';
import { registerRequestContext } from './common/middleware/request-context.middleware.js';
import { SentryService } from './common/observability/sentry.service.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';
import { ConfigService } from './config/config.service.js';
import { DispatchGateway } from './modules/dispatch/dispatch.gateway.js';
import { TrackingGateway } from './modules/tracking/tracking.gateway.js';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    logger: false,
    trustProxy: true,
    // Default 1 MiB body. The /import/runs route raises this via a
    // dedicated application/zip parser (registered after init) to accept
    // bundles up to 2 GiB. See registerImportZipParser below.
    bodyLimit: 1_048_576,
    genReqId: () => crypto.randomUUID(),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);

  registerRequestContext(app.getHttpAdapter().getInstance());

  const csp = config.csp;
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' on script is unavoidable for Stripe.js iframes; the
        // strict CSP for our own scripts lives on the web frontend where we
        // can guarantee bundling discipline.
        scriptSrc: ["'self'", ...csp.scriptSrc],
        connectSrc: ["'self'", ...csp.connectSrc],
        imgSrc: ["'self'", ...csp.imgSrc],
        frameSrc: ["'self'", ...csp.frameSrc],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' },
    noSniff: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  });
  await app.register(cookie, {});
  await app.register(compress, {
    global: true,
    threshold: config.compressionMinBytes,
    encodings: ['br', 'gzip', 'deflate'],
  });

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  const sentry = app.get(SentryService);
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter(config.logger, sentry));
  app.useGlobalInterceptors(new LoggingInterceptor(config.logger));

  app.enableShutdownHooks();

  // Replace Nest's default application/json parser with one that captures the
  // raw body for Stripe webhook signature verification. Must run after Nest
  // has wired its parser middleware (which happens during the implicit init).
  await app.init();
  registerRawBodyJsonParser(app.getHttpAdapter().getInstance());
  // Towbook import bundle parser. Buffers up to 2 GiB of application/zip.
  const fi = app.getHttpAdapter().getInstance();
  fi.addContentTypeParser(
    'application/zip',
    { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  const port = config.apiPort;
  const host = config.apiHost;
  await app.listen(port, host);

  // Attach the dispatch Socket.IO gateway to the running HTTP server. The
  // Fastify-adapted Nest app exposes the underlying Node http.Server via
  // getHttpServer(); we hand it to the gateway which adds the /socket.io
  // listener on top.
  const dispatchGateway = app.get(DispatchGateway);
  await dispatchGateway.attach(app.getHttpServer());

  // Mount the public /track namespace on top of the same Socket.IO server.
  // This way one Redis adapter + one set of CORS/origin rules is shared.
  const trackingGateway = app.get(TrackingGateway);
  const io = dispatchGateway.getServer();
  if (io) trackingGateway.attachNamespace(io);

  config.logger.info({ port, host, env: config.nodeEnv }, 'Tow Dispatch API listening');
}

bootstrap().catch((err) => {
  process.stderr.write(`bootstrap failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
