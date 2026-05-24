import { ServiceUnavailableException } from '@nestjs/common';
import type { VoiceCommandRequest } from '@ustowdispatch/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../../config/config.service.js';
import type { DriverAuthContext } from '../driver-experience/driver-auth.guard.js';
import { VoiceDriverController } from './voice-driver.controller.js';
import type { VoiceDriverService } from './voice-driver.service.js';

/**
 * Pure unit test of the VOICE_DRIVER_ENABLED gate. No DB / Nest container —
 * just verifies the controller short-circuits with 503 when the flag is off
 * and delegates to the service when it's on.
 */
function makeController(enabled: boolean, handle = vi.fn()) {
  const service = { handleCommand: handle } as unknown as VoiceDriverService;
  const config = { voiceDriverEnabled: enabled } as unknown as ConfigService;
  return { controller: new VoiceDriverController(service, config), handle };
}

const driver: DriverAuthContext = { driverId: 'd1', tenantId: 't1' };
const req = {
  requestContext: { requestId: 'r1', ipAddress: '127.0.0.1', userAgent: 'test' },
} as never;
const body: VoiceCommandRequest = { transcript: 'on scene', platform: 'web', locale: 'en' };

describe('VoiceDriverController — feature gate', () => {
  it('throws 503 service_unavailable when VOICE_DRIVER_ENABLED is false', async () => {
    const { controller, handle } = makeController(false);
    await expect(controller.command(body, driver, req)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it('delegates to the service when the flag is on', async () => {
    const handle = vi.fn().mockResolvedValue({ responseText: 'ok' });
    const { controller } = makeController(true, handle);
    await controller.command(body, driver, req);
    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0]?.[1]).toEqual(body);
  });
});
