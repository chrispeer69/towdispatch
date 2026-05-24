/**
 * Unit coverage for the release-workflow state machine (Yard Management,
 * Session 54). Pure — no DB / Nest container.
 */
import { describe, expect, it } from 'vitest';
import { type ReleaseState, evaluateReleaseTransition } from './release-workflow.logic.js';

const state = (over: Partial<ReleaseState> = {}): ReleaseState => ({
  status: 'initiated',
  hasIdVerified: false,
  hasLienholderAuth: false,
  hasPayment: false,
  ...over,
});

describe('evaluateReleaseTransition', () => {
  it('verify_id is allowed from initiated', () => {
    expect(evaluateReleaseTransition(state(), 'verify_id').allowed).toBe(true);
  });

  it('payment cannot be collected before ID is verified', () => {
    const r = evaluateReleaseTransition(state(), 'collect_payment');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/ID must be verified/i);
  });

  it('lienholder cannot be authorized before ID is verified', () => {
    expect(evaluateReleaseTransition(state(), 'authorize_lienholder').allowed).toBe(false);
  });

  it('payment is allowed once ID is verified', () => {
    expect(
      evaluateReleaseTransition(
        state({ status: 'id_verified', hasIdVerified: true }),
        'collect_payment',
      ).allowed,
    ).toBe(true);
  });

  it('gate release is blocked without payment OR lienholder auth', () => {
    const r = evaluateReleaseTransition(
      state({ status: 'id_verified', hasIdVerified: true }),
      'gate_release',
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/payment.*or lienholder/i);
  });

  it('gate release is allowed with a collected payment', () => {
    expect(
      evaluateReleaseTransition(
        state({ status: 'payment_collected', hasIdVerified: true, hasPayment: true }),
        'gate_release',
      ).allowed,
    ).toBe(true);
  });

  it('gate release is allowed with a lienholder authorization (no payment)', () => {
    expect(
      evaluateReleaseTransition(
        state({ status: 'lienholder_authorized', hasIdVerified: true, hasLienholderAuth: true }),
        'gate_release',
      ).allowed,
    ).toBe(true);
  });

  it('a cancelled workflow rejects every action except cancel (idempotent)', () => {
    const s = state({ status: 'cancelled' });
    expect(evaluateReleaseTransition(s, 'verify_id').allowed).toBe(false);
    expect(evaluateReleaseTransition(s, 'gate_release').allowed).toBe(false);
    expect(evaluateReleaseTransition(s, 'cancel').allowed).toBe(true);
  });

  it('a released workflow rejects everything except a no-op gate_release', () => {
    const s = state({ status: 'gate_released', hasIdVerified: true, hasPayment: true });
    expect(evaluateReleaseTransition(s, 'cancel').allowed).toBe(false);
    expect(evaluateReleaseTransition(s, 'collect_payment').allowed).toBe(false);
    expect(evaluateReleaseTransition(s, 'gate_release').allowed).toBe(true);
  });

  it('cancel is allowed from any non-terminal state', () => {
    expect(evaluateReleaseTransition(state(), 'cancel').allowed).toBe(true);
    expect(
      evaluateReleaseTransition(state({ status: 'payment_collected', hasPayment: true }), 'cancel')
        .allowed,
    ).toBe(true);
  });
});
