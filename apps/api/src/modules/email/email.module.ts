/**
 * Outbound email. Mailhog locally; real SMTP in production.
 *
 * Module is global so AuthService can inject EmailService without explicit
 * cross-module wiring. Templates are compiled lazily (on first send) and
 * cached in-memory for the process lifetime.
 */
import { Global, Module } from '@nestjs/common';
import { AdminEmailController } from './admin-email.controller.js';
import { EmailService } from './email.service.js';
import { TemplateRenderer } from './template-renderer.service.js';

@Global()
@Module({
  controllers: [AdminEmailController],
  providers: [EmailService, TemplateRenderer],
  exports: [EmailService],
})
export class EmailModule {}
