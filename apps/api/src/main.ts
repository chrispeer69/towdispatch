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
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { registerRequestContext } from './common/middleware/request-context.middleware.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';
import { ConfigService } from './config/config.service.js';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    logger: false,
    trustProxy: true,
    bodyLimit: 1_048_576,
    genReqId: () => crypto.randomUUID(),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);

  registerRequestContext(app.getHttpAdapter().getInstance());

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(cookie, {});

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter(config.logger));
  app.useGlobalInterceptors(new LoggingInterceptor(config.logger));

  app.enableShutdownHooks();

  const port = config.apiPort;
  const host = config.apiHost;
  await app.listen(port, host);
  config.logger.info({ port, host, env: config.nodeEnv }, 'TowCommand API listening');
}

bootstrap().catch((err) => {
  process.stderr.write(`bootstrap failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
