/**
 * Outbound email. Mailhog locally; real SMTP in production.
 *
 * Module is global so AuthService can inject EmailService without explicit
 * cross-module wiring. Templates are compiled lazily (on first send) and
 * cached in-memory for the process lifetime.
 */
import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { TemplateRenderer } from './template-renderer.service.js';

@Global()
@Module({
  providers: [EmailService, TemplateRenderer],
  exports: [EmailService],
})
export class EmailModule {}
