/**
 * Unit coverage for the guarded /_debug/boom endpoint. Locks in the three
 * gates: inert without the env flag, 401 without a valid token, and a tagged
 * Sentry capture + 500 once both gates pass.
 */
import {
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { SentryService } from '../../common/observability/sentry.service.js';
import type { ConfigService } from '../../config/config.service.js';
import { DebugController } from './debug.controller.js';

function build(smokeDebug: { enabled: boolean; token: string }): {
  controller: DebugController;
  capture: ReturnType<typeof vi.fn>;
} {
  const config = { smokeDebug } as unknown as ConfigService;
  const capture = vi.fn();
  const sentry = { captureSmokeError: capture } as unknown as SentryService;
  return { controller: new DebugController(config, sentry), capture };
}

describe('DebugController /_debug/boom', () => {
  it('404s and does not touch Sentry when disabled', () => {
    const { controller, capture } = build({ enabled: false, token: 'secret-token' });
    expect(() => controller.boom('m1', 'Bearer secret-token')).toThrow(NotFoundException);
    expect(capture).not.toHaveBeenCalled();
  });

  it('404s when enabled but no token is configured', () => {
    const { controller, capture } = build({ enabled: true, token: '' });
    expect(() => controller.boom('m1', 'Bearer anything')).toThrow(NotFoundException);
    expect(capture).not.toHaveBeenCalled();
  });

  it('401s on a missing bearer token', () => {
    const { controller, capture } = build({ enabled: true, token: 'secret-token' });
    expect(() => controller.boom('m1', undefined)).toThrow(UnauthorizedException);
    expect(capture).not.toHaveBeenCalled();
  });

  it('401s on a wrong bearer token', () => {
    const { controller, capture } = build({ enabled: true, token: 'secret-token' });
    expect(() => controller.boom('m1', 'Bearer wrong')).toThrow(UnauthorizedException);
    expect(capture).not.toHaveBeenCalled();
  });

  it('captures a marked Sentry event then throws 500 when both gates pass', () => {
    const { controller, capture } = build({ enabled: true, token: 'secret-token' });
    expect(() => controller.boom('smoke-abc123', 'Bearer secret-token')).toThrow(
      InternalServerErrorException,
    );
    expect(capture).toHaveBeenCalledTimes(1);
    const [marker, err] = capture.mock.calls[0] as [string, Error];
    expect(marker).toBe('smoke-abc123');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('smoke-abc123');
  });

  it('defaults the marker when absent', () => {
    const { controller, capture } = build({ enabled: true, token: 'secret-token' });
    expect(() => controller.boom(undefined, 'Bearer secret-token')).toThrow(
      InternalServerErrorException,
    );
    expect(capture.mock.calls[0]?.[0]).toBe('no-marker');
  });
});
