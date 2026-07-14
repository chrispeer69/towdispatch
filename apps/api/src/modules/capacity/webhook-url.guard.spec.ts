/**
 * SSRF URL guard unit coverage — static (no-DNS) checks. The DNS-resolving
 * path is exercised in the capacity integration spec against localhost.
 */
import { describe, expect, it } from 'vitest';
import { isPrivateIpv4, isPrivateIpv6, staticUrlProblem } from './webhook-url.guard.js';

const prod = { allowLoopback: false };
const dev = { allowLoopback: true };

describe('staticUrlProblem — production rules', () => {
  it('accepts a public https URL', () => {
    expect(staticUrlProblem('https://hooks.agero.example.com/capacity', prod)).toBeNull();
  });
  it('rejects http', () => {
    expect(staticUrlProblem('http://example.com/hook', prod)).toContain('https');
  });
  it('rejects garbage', () => {
    expect(staticUrlProblem('not a url', prod)).toBe('not a valid URL');
  });
  it('rejects credentials in the URL', () => {
    expect(staticUrlProblem('https://user:pw@example.com/', prod)).toContain('credentials');
  });
  it('rejects localhost and internal hostnames', () => {
    expect(staticUrlProblem('https://localhost/hook', prod)).not.toBeNull();
    expect(staticUrlProblem('https://metadata.google.internal/x', prod)).not.toBeNull();
    expect(staticUrlProblem('https://db.acme.internal/x', prod)).not.toBeNull();
    expect(staticUrlProblem('https://printer.local/x', prod)).not.toBeNull();
  });
  it('rejects literal private / reserved IPs', () => {
    for (const ip of [
      '10.0.0.5',
      '192.168.1.10',
      '172.16.9.9',
      '169.254.169.254',
      '127.0.0.1',
      '100.64.0.1',
      '0.0.0.0',
    ]) {
      expect(staticUrlProblem(`https://${ip}/hook`, prod)).not.toBeNull();
    }
  });
  it('rejects private IPv6 (loopback, ULA, link-local, v4-mapped)', () => {
    for (const ip of ['[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:10.0.0.1]']) {
      expect(staticUrlProblem(`https://${ip}/hook`, prod)).not.toBeNull();
    }
  });
  it('accepts public literal IPs', () => {
    expect(staticUrlProblem('https://8.8.8.8/hook', prod)).toBeNull();
  });
});

describe('staticUrlProblem — dev/test loopback allowance', () => {
  it('allows http://localhost for the seeded demo echo endpoint', () => {
    expect(staticUrlProblem('http://localhost:4010/echo', dev)).toBeNull();
    expect(staticUrlProblem('http://127.0.0.1:4010/echo', dev)).toBeNull();
  });
  it('still rejects RFC1918 even in dev', () => {
    expect(staticUrlProblem('https://10.1.2.3/hook', dev)).not.toBeNull();
  });
});

describe('IP range predicates', () => {
  it('classifies IPv4 ranges', () => {
    expect(isPrivateIpv4('10.255.255.255', false)).toBe(true);
    expect(isPrivateIpv4('172.31.0.1', false)).toBe(true);
    expect(isPrivateIpv4('172.32.0.1', false)).toBe(false);
    expect(isPrivateIpv4('8.8.4.4', false)).toBe(false);
    expect(isPrivateIpv4('127.0.0.1', true)).toBe(false); // loopback allowed in dev
  });
  it('classifies IPv6 ranges', () => {
    expect(isPrivateIpv6('::1', false)).toBe(true);
    expect(isPrivateIpv6('::1', true)).toBe(false);
    expect(isPrivateIpv6('fd12:3456::1', false)).toBe(true);
    expect(isPrivateIpv6('2607:f8b0::1', false)).toBe(false);
  });
});
