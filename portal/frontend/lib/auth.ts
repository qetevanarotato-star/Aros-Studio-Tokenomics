export type PortalRole = 'institution' | 'counterparty' | 'holder' | 'operator';

export interface PortalSession {
  sessionId: string;
  institutionId: string;
  displayName: string;
  expiresAt: string;
  /** B/D roles; default institution for older sessions */
  role?: PortalRole;
}

const KEY = 'ast_portal_session';

export function loadSession(): PortalSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PortalSession;
    if (Date.parse(s.expiresAt) < Date.now()) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: PortalSession): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

/**
 * API base for browser calls.
 * - empty / "same" → same-origin (Next rewrites /v1 → portal edge) — home / tunnel
 * - absolute URL → direct edge (local split ports)
 */
export function apiBase(): string {
  const env = process.env.NEXT_PUBLIC_PORTAL_API_URL;
  if (env === undefined || env === '' || env === 'same' || env === 'same-origin') {
    return '';
  }
  return env.replace(/\/$/, '');
}

export async function portalFetch(
  path: string,
  init: RequestInit & { sessionId?: string; idempotencyKey?: string } = {},
): Promise<Response> {
  const { sessionId, idempotencyKey, headers, ...rest } = init;
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  if (sessionId) h.set('X-Session-Id', sessionId);
  if (idempotencyKey) h.set('Idempotency-Key', idempotencyKey);
  const base = apiBase();
  const url = path.startsWith('http') ? path : `${base}${path}`;
  return fetch(url, { ...rest, headers: h });
}
