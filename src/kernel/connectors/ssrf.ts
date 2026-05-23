// SSRF / private-network guard for HTTP connectors (M4a — PR3a, spec §8 / B5).
//
// Refuses a `baseUrl` whose host (literal IP or resolved A/AAAA) lands in a
// private / loopback / link-local / unique-local range, unless the operator
// has opted in with `allowLocalNetwork: true` on the instance config (or via
// a preset's `allowLocalNetwork`; the runtime computes the effective flag).
//
// Server-only. Used at config-add time (PR3b) and at testConnection time
// (M4a-1 — testConnection.ts). Request-time DNS re-resolution is a known
// post-M4a limitation (spec §8). The HTTP family additionally refuses to
// follow 3xx redirects (B11), closing the redirect-rebinding angle.

import { promises as dns } from "node:dns";
import { isIP } from "node:net";

export class SsrfBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockError";
  }
}

/**
 * Walks the IPv4 dotted-quad and returns true for any private / loopback /
 * unspecified / link-local range:
 *   127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *   169.254.0.0/16, 0.0.0.0.
 */
export function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split(".");
  if (parts.length !== 4) return false;
  const n = parts.map((p) => Number(p));
  if (n.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = n as [number, number, number, number];
  if (a === 0) return true;                              // 0.0.0.0
  if (a === 10) return true;                             // 10.0.0.0/8
  if (a === 127) return true;                            // loopback
  if (a === 169 && b === 254) return true;               // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
  if (a === 192 && b === 168) return true;               // 192.168.0.0/16
  return false;
}

/**
 * Checks an IPv6 literal for loopback (::1), unspecified (::), unique-local
 * (fc00::/7) or link-local (fe80::/10). A zone-id suffix (e.g. "%eth0") is
 * stripped before the check.
 */
export function isPrivateIPv6(addr: string): boolean {
  const noZone = addr.toLowerCase().split("%")[0] ?? "";
  if (noZone === "::1" || noZone === "::") return true;
  // fc00::/7 — first byte 0xfc or 0xfd
  if (/^fc[0-9a-f]{2}:/.test(noZone) || /^fd[0-9a-f]{2}:/.test(noZone)) return true;
  // fe80::/10 — first byte 0xfe + next nibble 8..b -> "fe80::" to "febf::"
  if (/^fe[89ab][0-9a-f]:/.test(noZone)) return true;
  return false;
}

function blockedHostnameLiteral(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost";
}

export interface AssertPublicBaseUrlOpts {
  allowLocalNetwork: boolean;
  /** Test seam — production uses node:dns. */
  resolver?: (host: string) => Promise<string[]>;
}

async function defaultResolver(host: string): Promise<string[]> {
  const out: string[] = [];
  const [v4, v6] = await Promise.allSettled([
    dns.resolve4(host),
    dns.resolve6(host),
  ]);
  if (v4.status === "fulfilled") out.push(...v4.value);
  if (v6.status === "fulfilled") out.push(...v6.value);
  return out;
}

/**
 * Throw a {@link SsrfBlockError} if `baseUrl`'s host (or any of its resolved
 * addresses) lands in a private range. Pass `allowLocalNetwork: true` to
 * opt in (used by the ollama-local preset and any custom endpoint the
 * operator explicitly opens up). Errors carry only a neutral reason; the
 * blocked address is never embedded in the message.
 */
export async function assertPublicBaseUrl(
  baseUrl: string,
  opts: AssertPublicBaseUrlOpts,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new SsrfBlockError("baseUrl is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockError("baseUrl must use http(s)");
  }
  const host = url.hostname; // already lowercased / unbracketed by URL parser
  if (!host) throw new SsrfBlockError("baseUrl has no host");

  if (opts.allowLocalNetwork) return;

  if (blockedHostnameLiteral(host)) {
    throw new SsrfBlockError("baseUrl host is in a blocked range");
  }

  const literalType = isIP(host);
  if (literalType === 4) {
    if (isPrivateIPv4(host)) {
      throw new SsrfBlockError("baseUrl host is in a blocked range");
    }
    return;
  }
  if (literalType === 6) {
    if (isPrivateIPv6(host)) {
      throw new SsrfBlockError("baseUrl host is in a blocked range");
    }
    return;
  }

  // Hostname — resolve DNS and check every address.
  let addrs: string[];
  try {
    addrs = await (opts.resolver ?? defaultResolver)(host);
  } catch {
    throw new SsrfBlockError("baseUrl host DNS resolution failed");
  }
  if (addrs.length === 0) {
    throw new SsrfBlockError("baseUrl host did not resolve");
  }
  for (const a of addrs) {
    const t = isIP(a);
    if (t === 4 && isPrivateIPv4(a)) {
      throw new SsrfBlockError("baseUrl host resolves to a blocked range");
    }
    if (t === 6 && isPrivateIPv6(a)) {
      throw new SsrfBlockError("baseUrl host resolves to a blocked range");
    }
  }
}
