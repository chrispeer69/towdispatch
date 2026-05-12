/**
 * In-memory mock for APNs / FCM. Records every send call so the E2E
 * suite can assert what the server tried to push without binding to
 * Apple sandbox or Google Firebase.
 *
 * Active when PUSH_PROVIDER=mock (default in dev + test). The real
 * provider lives at apns.service.ts / fcm.service.ts (placeholders for
 * Phase 1); switching is one env var.
 *
 * Exposes:
 *   - GET  /push/_test/sent       all sent notifications
 *   - GET  /push/_test/sent/:token  filtered by device token
 *   - POST /push/_test/clear      reset the in-memory log
 *
 * These endpoints are 404'd outside NODE_ENV in {development, test}.
 */
import { BadRequestException, Controller, Get, Injectable, Param, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';

export interface PushNotification {
  deviceToken: string;
  platform: 'apns' | 'fcm';
  title: string;
  body: string;
  data?: Record<string, string>;
  sentAt: string;
}

@Injectable()
export class PushMockService {
  private readonly sent: PushNotification[] = [];

  async send(notification: Omit<PushNotification, 'sentAt'>): Promise<void> {
    this.sent.push({ ...notification, sentAt: new Date().toISOString() });
  }

  getSent(deviceToken?: string): PushNotification[] {
    if (!deviceToken) return this.sent.slice();
    return this.sent.filter((n) => n.deviceToken === deviceToken);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

@Controller('push/_test')
export class PushMockController {
  constructor(private readonly mock: PushMockService) {}

  private assertEnabled(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('push mock endpoints disabled in production');
    }
  }

  @Public()
  @Get('sent')
  list(): PushNotification[] {
    this.assertEnabled();
    return this.mock.getSent();
  }

  @Public()
  @Get('sent/:token')
  listForToken(@Param('token') token: string): PushNotification[] {
    this.assertEnabled();
    return this.mock.getSent(token);
  }

  @Public()
  @Post('clear')
  clear(): { cleared: true } {
    this.assertEnabled();
    this.mock.clear();
    return { cleared: true };
  }
}
