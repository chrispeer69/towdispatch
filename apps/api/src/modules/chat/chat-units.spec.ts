/**
 * Pure-helper tests for ChatService — wire-format mappers and cursor codec.
 * These verify the contract the iOS client depends on without standing up
 * a database. Behavioral tests (idempotency, participant gating, RLS
 * isolation) live in test/integration/chat.spec.ts and require Postgres.
 */
import { describe, expect, it } from 'vitest';
import { ChatServiceTestables } from './chat.testables.js';

describe('ChatService — kind/attachment mapping (iOS wire format)', () => {
  it('voice attachment → kind=voice', () => {
    expect(ChatServiceTestables.kindFromAttachment('voice_memo')).toBe('voice');
  });
  it('photo attachment → kind=photo', () => {
    expect(ChatServiceTestables.kindFromAttachment('photo')).toBe('photo');
  });
  it('video attachment → kind=video', () => {
    expect(ChatServiceTestables.kindFromAttachment('video')).toBe('video');
  });
  it('no attachment → kind=text', () => {
    expect(ChatServiceTestables.kindFromAttachment('none')).toBe('text');
  });
});

describe('ChatService — sender derivation', () => {
  it('driver author → driver sender', () => {
    expect(ChatServiceTestables.senderFromAuthorRole('driver')).toBe('driver');
  });
  it.each(['dispatcher', 'admin', 'manager'] as const)(
    '%s author folds into dispatcher sender (iOS only knows driver/dispatcher/system)',
    (role) => {
      expect(ChatServiceTestables.senderFromAuthorRole(role)).toBe('dispatcher');
    },
  );
});

describe('ChatService — delivery state derivation', () => {
  it('read_at set → read (read takes precedence over delivered)', () => {
    expect(
      ChatServiceTestables.deliveryStateFromRow({
        readAt: new Date('2026-05-12T01:00:00Z'),
        deliveredAt: new Date('2026-05-12T00:59:00Z'),
      }),
    ).toBe('read');
  });
  it('delivered_at set, read_at null → delivered', () => {
    expect(
      ChatServiceTestables.deliveryStateFromRow({
        readAt: null,
        deliveredAt: new Date('2026-05-12T00:59:00Z'),
      }),
    ).toBe('delivered');
  });
  it("neither set → sent (server has it, recipient hasn't ack'd)", () => {
    expect(ChatServiceTestables.deliveryStateFromRow({ readAt: null, deliveredAt: null })).toBe(
      'sent',
    );
  });
});

describe('ChatService — pagination cursor', () => {
  it('round-trips (createdAt, id)', () => {
    const createdAt = new Date('2026-05-12T01:23:45.678Z');
    const id = '01914f0a-7d3b-7a4c-9f23-abcdef012345';
    const enc = ChatServiceTestables.encodeCursor(createdAt, id);
    const dec = ChatServiceTestables.decodeCursor(enc);
    expect(dec).not.toBeNull();
    expect(dec?.id).toBe(id);
    expect(dec?.createdAt.toISOString()).toBe(createdAt.toISOString());
  });
  it('rejects malformed cursors with null (not a throw — the route returns first page)', () => {
    expect(ChatServiceTestables.decodeCursor('not-base64!@#$')).toBeNull();
    expect(ChatServiceTestables.decodeCursor('YWJj')).toBeNull(); // no separator
  });
});
