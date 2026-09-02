/** Inclusive TCP/UDP port bounds. */
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

/** True when `n` is a usable transport port. */
export function isPortNumber(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_PORT && n <= MAX_PORT;
}

/**
 * Parse a palette chip into a TCP port.
 *
 * Accepts a bare number (`3000`), a leading colon (`:8080`), or the port
 * on a host/URL (`localhost:3000`, `http://127.0.0.1:5173/path`). Text rather
 * than `number` on the action so those forms survive chip validation, the
 * same way Timer keeps duration as free text.
 */
export function parsePort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return asPort(Number(trimmed));
  const matches = [...trimmed.matchAll(/:(\d+)/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  return asPort(Number(last[1]));
}

/** Reject fractions, zero, and anything outside the 16-bit port range. */
function asPort(n: number): number | null {
  return isPortNumber(n) ? n : null;
}
