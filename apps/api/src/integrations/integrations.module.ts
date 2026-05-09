/**
 * Houses the IntegrationRegistry. Provider implementations live in their own
 * modules and inject the registry to call .register() on init. Empty at
 * scaffold time — implementations land in later prompts.
 */
import { Global, Module } from '@nestjs/common';
import { IntegrationRegistry } from './types.js';

@Global()
@Module({
  providers: [IntegrationRegistry],
  exports: [IntegrationRegistry],
})
export class IntegrationsModule {}
