/**
 * Provider status mapping — verifies the Twilio / SendGrid / Mailgun
 * status enums route to the correct internal NotificationDeliveryStatus
 * value. The DB-touching path is exercised by the integration tests.
 */
import { describe, expect, it } from 'vitest';
import type { ConfigService } from '../../../config/config.service.js';
import type { DeliveryTrackingService } from './delivery-tracking.service.js';
import { ProviderWebhooksController } from './provider-webhooks.controller.js';

describe('ProviderWebhooksController status mapping', () => {
  const ctrl = new ProviderWebhooksController(
    {} as DeliveryTrackingService,
    { apiPublicUrl: 'http://localhost', notification: { twilio: { authToken: '' } }, notifications: { sendgrid: { verificationKey: '' }, mailgun: { apiKey: '' } } } as unknown as ConfigService,
  );

  // We can't call the private methods directly without a `(ctrl as any)`
  // dance; that's the trade-off for keeping them private. Use the dispatch
  // shape to verify mapping indirectly.
  const anyCtrl = ctrl as unknown as {
    mapTwilioStatus(s: string): string | null;
    mapSendgridEvent(s: string): string | null;
    mapMailgunEvent(s: string): string | null;
  };

  it('maps Twilio statuses', () => {
    expect(anyCtrl.mapTwilioStatus('queued')).toBe('sent');
    expect(anyCtrl.mapTwilioStatus('delivered')).toBe('delivered');
    expect(anyCtrl.mapTwilioStatus('failed')).toBe('failed');
    expect(anyCtrl.mapTwilioStatus('undelivered')).toBe('failed');
    expect(anyCtrl.mapTwilioStatus('weird-status')).toBeNull();
  });

  it('maps SendGrid events', () => {
    expect(anyCtrl.mapSendgridEvent('processed')).toBe('sent');
    expect(anyCtrl.mapSendgridEvent('delivered')).toBe('delivered');
    expect(anyCtrl.mapSendgridEvent('bounce')).toBe('bounced');
    expect(anyCtrl.mapSendgridEvent('dropped')).toBe('bounced');
    expect(anyCtrl.mapSendgridEvent('open')).toBeNull();
  });

  it('maps Mailgun events', () => {
    expect(anyCtrl.mapMailgunEvent('accepted')).toBe('sent');
    expect(anyCtrl.mapMailgunEvent('delivered')).toBe('delivered');
    expect(anyCtrl.mapMailgunEvent('failed')).toBe('bounced');
    expect(anyCtrl.mapMailgunEvent('rejected')).toBe('bounced');
    expect(anyCtrl.mapMailgunEvent('opened')).toBeNull();
  });
});
