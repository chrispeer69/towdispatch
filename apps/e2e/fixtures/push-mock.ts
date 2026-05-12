/**
 * E2E client for the in-API push mock. Reads notifications captured by
 * PushMockService at /push/_test/sent and lets tests assert what the
 * server tried to deliver.
 *
 * Wire into a test:
 *
 *     const pushMock = new PushMock();
 *     await pushMock.clear();
 *     // ... action that triggers a push ...
 *     const sent = await pushMock.getSent('device-token-abc');
 *     expect(sent).toHaveLength(1);
 */
const API_BASE = process.env.API_E2E_BASE_URL ?? 'http://localhost:3601';

export interface CapturedPush {
  deviceToken: string;
  platform: 'apns' | 'fcm';
  title: string;
  body: string;
  data?: Record<string, string>;
  sentAt: string;
}

export class PushMock {
  async getSent(deviceToken?: string): Promise<CapturedPush[]> {
    const url = deviceToken
      ? `${API_BASE}/push/_test/sent/${encodeURIComponent(deviceToken)}`
      : `${API_BASE}/push/_test/sent`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`push mock list failed: ${res.status}`);
    return (await res.json()) as CapturedPush[];
  }

  async clear(): Promise<void> {
    const res = await fetch(`${API_BASE}/push/_test/clear`, { method: 'POST' });
    if (!res.ok) throw new Error(`push mock clear failed: ${res.status}`);
  }
}
