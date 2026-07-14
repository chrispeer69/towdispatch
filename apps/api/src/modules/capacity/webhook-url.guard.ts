/**
 * Outbound webhook URL validation (SSRF guard). A partner webhook URL must
 * never let the delivery worker POST into our own infrastructure: cloud
 * metadata endpoints, RFC1918 ranges, loopback, link-local.
 *
 * Checked twice: at partner create/update (fail fast with a 4xx) and again
 * immediately before every POST (DNS can change between registration and
 * delivery — classic rebinding). Outside production, loopback is allowed so
 * the seeded demo partner can point at a local echo endpoint.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface UrlGuardOptions {
  /** Allow http:// + loopback targets (dev/test only). */
  allowLoopback: boolean;
}

const BLOCKED_HOSTNAMES = new Set(['metadata.google.internal', 'metadata', 'localhost']);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (
    (((parts[0] ?? 0) << 24) |
      ((parts[1] ?? 0) << 16) |
      ((parts[2] ?? 0) << 8) |
      (parts[3] ?? 0)) >>>
    0
  );
}

function inCidr(ip: number, base: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

/** RFC1918 + loopback + link-local + CGN + metadata + unspecified. */
export function isPrivateIpv4(ip: string, allowLoopback: boolean): boolean {
  const n = ipv4ToInt(ip);
  if (!allowLoopback && inCidr(n, '127.0.0.0', 8)) return true;
  return (
    inCidr(n, '0.0.0.0', 8) ||
    inCidr(n, '10.0.0.0', 8) ||
    inCidr(n, '100.64.0.0', 10) ||
    inCidr(n, '169.254.0.0', 16) ||
    inCidr(n, '172.16.0.0', 12) ||
    inCidr(n, '192.168.0.0', 16)
  );
}

export function isPrivateIpv6(ip: string, allowLoopback: boolean): boolean {
  const lower = ip.toLowerCase();
  if (!allowLoopback && (lower === '::1' || lower === '0:0:0:0:0:0:0:1')) return true;
  if (lower === '::') return true;
  // Unique-local fc00::/7 and link-local fe80::/10.
  if (
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    return true;
  }
  // IPv4-mapped (::ffff:a.b.c.d, or the canonical hex form ::ffff:a00:1
  // the URL parser produces) — recheck the embedded v4.
  const dotted = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1]) return isPrivateIpv4(dotted[1], allowLoopback);
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex?.[1] && hex[2]) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    const v4 = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    return isPrivateIpv4(v4, allowLoopback);
  }
  return false;
}

function isPrivateIp(ip: string, allowLoopback: boolean): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip, allowLoopback);
  if (family === 6) return isPrivateIpv6(ip, allowLoopback);
  return true; // not an IP at all — treat as unsafe
}

/**
 * Static (no-DNS) shape check. Returns an error string or null when OK.
 * Exported separately so it can run synchronously in validation paths.
 */
export function staticUrlProblem(rawUrl: string, opts: UrlGuardOptions): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'not a valid URL';
  }
  if (url.protocol !== 'https:' && !(opts.allowLoopback && url.protocol === 'http:')) {
    return 'must use https';
  }
  if (url.username || url.password) return 'credentials in URL are not allowed';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const lower = host.toLowerCase();
  if (
    !opts.allowLoopback &&
    (BLOCKED_HOSTNAMES.has(lower) || lower.endsWith('.internal') || lower.endsWith('.local'))
  ) {
    return 'internal hostnames are not allowed';
  }
  if (isIP(host) && isPrivateIp(host, opts.allowLoopback)) {
    return 'private or reserved IP ranges are not allowed';
  }
  return null;
}

/**
 * Full check including DNS resolution of every A/AAAA record. Returns an
 * error string or null when the URL is safe to POST to.
 */
export async function urlProblem(rawUrl: string, opts: UrlGuardOptions): Promise<string | null> {
  const staticProblem = staticUrlProblem(rawUrl, opts);
  if (staticProblem) return staticProblem;
  const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return null; // literal IP already vetted statically
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    for (const rec of records) {
      if (isPrivateIp(rec.address, opts.allowLoopback)) {
        return `resolves to a private address (${rec.address})`;
      }
    }
  } catch {
    return 'hostname does not resolve';
  }
  return null;
}
