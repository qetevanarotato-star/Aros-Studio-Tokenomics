import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import {
  institutionIdFromClaims,
  loadMtlsMap,
  mapSubjectToInstitution,
  mtlsTrustProxy,
  passwordLoginAllowed,
  subjectFromMtlsHeaders,
  verifyOidcHs256,
} from './mtls-oidc';
import { RedisSessionStore } from '../../common/redis-session-store';

/** Portal edge role (two-sided + ops). Default institution. */
export type PortalRole = 'institution' | 'counterparty' | 'holder' | 'operator';

export interface InstitutionAccount {
  institutionId: string;
  displayName: string;
  /** Shared secret (v1). Prod target: mTLS / OIDC + secrets store. */
  token: string;
  allowlisted: boolean;
  /** B/D: institution (default) | counterparty | holder | operator */
  role?: PortalRole;
}

export interface Session {
  sessionId: string;
  institutionId: string;
  displayName: string;
  token: string;
  role: PortalRole;
  createdAt: string;
  expiresAt: string;
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly accounts = new Map<string, InstitutionAccount>();
  private readonly sessions = new Map<string, Session>();
  /** I2 optional Redis dual-write (not SoT; multi-replica still needs sticky or async resolve). */
  private readonly redis = RedisSessionStore.fromEnv();

  constructor() {
    for (const a of loadAccounts()) {
      this.accounts.set(a.institutionId.toUpperCase(), {
        ...a,
        institutionId: a.institutionId.toUpperCase(),
      });
    }
  }

  login(
    institutionId: string | undefined,
    token: string | undefined,
  ):
    | { ok: true; session: Session }
    | { ok: false; code: string; message: string } {
    if (!passwordLoginAllowed()) {
      return {
        ok: false,
        code: 'AUTH_PASSWORD_DISABLED',
        message:
          'password login disabled — use POST /v1/auth/login/mtls or /v1/auth/login/oidc (AST_REQUIRE_MTLS / AST_REQUIRE_OIDC)',
      };
    }
    if (!institutionId?.trim() || !token?.trim()) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'institutionId and token required',
      };
    }
    if (this.accounts.size === 0) {
      return {
        ok: false,
        code: 'AUTH_NOT_CONFIGURED',
        message:
          'no institutions configured — set AST_INSTITUTION_SECRETS_JSON (production)',
      };
    }
    // login is institution id (case-insensitive); salt is the shared secret (token field)
    const loginKey = institutionId.trim().toUpperCase();
    const acc = this.accounts.get(loginKey);
    if (!acc || !tokensEqual(acc.token, token.trim())) {
      return {
        ok: false,
        code: 'AUTH_INVALID',
        message: 'invalid institution credentials',
      };
    }
    if (!acc.allowlisted) {
      return {
        ok: false,
        code: 'AUTH_NOT_ALLOWLISTED',
        message: 'institution not allowlisted',
      };
    }
    return this.issueSession(acc);
  }

  /**
   * D6 mTLS: identity from reverse-proxy client cert headers + map file.
   */
  loginMtls(
    headers: Record<string, string | string[] | undefined>,
  ):
    | { ok: true; session: Session; subject: string }
    | { ok: false; code: string; message: string } {
    if (!mtlsTrustProxy()) {
      return {
        ok: false,
        code: 'MTLS_PROXY_REQUIRED',
        message: 'set AST_MTLS_TRUST_PROXY=1 only behind a trusted TLS terminator',
      };
    }
    const subject = subjectFromMtlsHeaders(headers);
    if (!subject) {
      return {
        ok: false,
        code: 'MTLS_CLIENT_MISSING',
        message: 'missing client certificate subject headers from proxy',
      };
    }
    const map = loadMtlsMap();
    if (map.length === 0) {
      return {
        ok: false,
        code: 'MTLS_MAP_NOT_CONFIGURED',
        message: 'set AST_MTLS_MAP_FILE or AST_MTLS_MAP_JSON',
      };
    }
    const hit = mapSubjectToInstitution(subject, map);
    if (!hit) {
      return {
        ok: false,
        code: 'MTLS_NOT_MAPPED',
        message: 'client certificate subject not mapped to an institution',
      };
    }
    const acc = this.accounts.get(hit.institutionId);
    if (acc) {
      if (!acc.allowlisted) {
        return { ok: false, code: 'AUTH_NOT_ALLOWLISTED', message: 'institution not allowlisted' };
      }
      const r = this.issueSession(acc);
      if (!r.ok) return r;
      return { ok: true, session: r.session, subject };
    }
    // Allow map-only institution when secrets not preloaded (pilot)
    const synthetic: InstitutionAccount = {
      institutionId: hit.institutionId,
      displayName: hit.displayName ?? hit.institutionId,
      token: `mtls:${hit.institutionId}`,
      allowlisted: true,
    };
    const r = this.issueSession(synthetic);
    if (!r.ok) return r;
    return { ok: true, session: r.session, subject };
  }

  /**
   * D6 OIDC pilot: HS256 bearer JWT (JWKS residual).
   */
  loginOidc(
    authorizationHeader: string | undefined,
  ):
    | { ok: true; session: Session }
    | { ok: false; code: string; message: string } {
    const secret = process.env.AST_OIDC_HS_SECRET?.trim();
    if (!secret) {
      return {
        ok: false,
        code: 'OIDC_NOT_CONFIGURED',
        message: 'set AST_OIDC_HS_SECRET for pilot OIDC (JWKS residual for production)',
      };
    }
    const raw = authorizationHeader?.trim() ?? '';
    const m = raw.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return {
        ok: false,
        code: 'OIDC_REQUIRED',
        message: 'Authorization: Bearer <jwt> required',
      };
    }
    const v = verifyOidcHs256(m[1].trim(), secret, {
      audience: process.env.AST_OIDC_AUDIENCE?.trim() || undefined,
      issuer: process.env.AST_OIDC_ISSUER?.trim() || undefined,
    });
    if (!v.ok) return v;
    const instId = institutionIdFromClaims(v.claims);
    if (!instId) {
      return {
        ok: false,
        code: 'OIDC_NO_INSTITUTION',
        message: 'JWT missing institution_id / sub',
      };
    }
    const acc = this.accounts.get(instId);
    if (acc) {
      if (!acc.allowlisted) {
        return { ok: false, code: 'AUTH_NOT_ALLOWLISTED', message: 'institution not allowlisted' };
      }
      return this.issueSession(acc);
    }
    return this.issueSession({
      institutionId: instId,
      displayName: instId,
      token: `oidc:${instId}`,
      allowlisted: true,
    });
  }

  private issueSession(
    acc: InstitutionAccount,
  ):
    | { ok: true; session: Session }
    | { ok: false; code: string; message: string } {
    const sessionId = randomBytes(24).toString('hex');
    const now = Date.now();
    const session: Session = {
      sessionId,
      institutionId: acc.institutionId,
      displayName: acc.displayName,
      token: acc.token,
      role: normalizeRole(acc.role),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    };
    this.sessions.set(sessionId, session);
    void this.redis
      ?.setJson(sessionId, session, Math.floor(SESSION_TTL_MS / 1000))
      .catch(() => undefined);
    return { ok: true, session };
  }

  logout(sessionId: string | undefined): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
      void this.redis?.del(sessionId).catch(() => undefined);
    }
  }

  resolve(sessionId: string | undefined): Session | null {
    if (!sessionId) return null;
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    if (Date.parse(s.expiresAt) < Date.now()) {
      this.sessions.delete(sessionId);
      void this.redis?.del(sessionId).catch(() => undefined);
      return null;
    }
    if (!s.role) s.role = 'institution';
    return s;
  }

  listInstitutionsPublic(): Array<{
    institutionId: string;
    displayName: string;
    role: PortalRole;
  }> {
    return [...this.accounts.values()]
      .filter((a) => a.allowlisted)
      .map((a) => ({
        institutionId: a.institutionId,
        displayName: a.displayName,
        role: normalizeRole(a.role),
      }))
      .sort((a, b) => a.institutionId.localeCompare(b.institutionId));
  }

  getAccount(institutionId: string): InstitutionAccount | undefined {
    return this.accounts.get(institutionId.trim().toUpperCase());
  }

  isAllowlistedInstitution(institutionId: string): boolean {
    const a = this.getAccount(institutionId);
    return Boolean(a?.allowlisted);
  }

  configuredCount(): number {
    return this.accounts.size;
  }
}

function normalizeRole(role: unknown): PortalRole {
  const r = String(role ?? 'institution').toLowerCase();
  if (r === 'operator' || r === 'ops') return 'operator';
  if (r === 'counterparty' || r === 'counter') return 'counterparty';
  if (r === 'holder') return 'holder';
  return 'institution';
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Production: AST_INSTITUTION_SECRETS_JSON and/or AST_INSTITUTION_SECRETS_FILE.
 * Local/dev: AST_ALLOW_DEMO=1 → DEMO/ACME (never default in production).
 *
 * Prefer FILE for real secrets (not shell history). Path example:
 *   data/institution-secrets.json  (gitignored via data/)
 */
export function loadAccounts(): InstitutionAccount[] {
  const fromEnv = parseAccountsJson(process.env.AST_INSTITUTION_SECRETS_JSON);
  if (fromEnv.length > 0) return fromEnv;

  const filePath = process.env.AST_INSTITUTION_SECRETS_FILE?.trim();
  if (filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const fromFile = parseAccountsJson(raw);
        if (fromFile.length > 0) return fromFile;
      }
    } catch {
      /* fallthrough */
    }
  }

  if (!allowDemoInstitutions()) {
    return [];
  }

  return [
    {
      /** Quick local entry: login pilot · salt pilot */
      institutionId: 'PILOT',
      displayName: 'Pilot Institution',
      token: process.env.AST_PILOT_SALT ?? 'pilot',
      allowlisted: true,
      role: 'institution',
    },
    {
      institutionId: 'COUNTER',
      displayName: 'Counterparty Pilot',
      token: process.env.AST_COUNTER_SALT ?? 'counter',
      allowlisted: true,
      role: 'counterparty',
    },
    {
      institutionId: 'HOLDER1',
      displayName: 'Holder Pilot',
      token: process.env.AST_HOLDER_SALT ?? 'holder',
      allowlisted: true,
      role: 'holder',
    },
    {
      institutionId: 'OPS',
      displayName: 'AST Operator',
      token: process.env.AST_OPS_SALT ?? 'ops',
      allowlisted: true,
      role: 'operator',
    },
    {
      institutionId: 'DEMO',
      displayName: 'Demo Institution',
      token: process.env.AST_INSTITUTION_TOKEN ?? 'demo-institution-token',
      allowlisted: true,
      role: 'institution',
    },
    {
      institutionId: 'ACME',
      displayName: 'ACME Capital Markets',
      token: process.env.AST_ACME_TOKEN ?? 'acme-institution-token',
      allowlisted: true,
      role: 'institution',
    },
  ];
}

export function parseAccountsJson(json: string | undefined | null): InstitutionAccount[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json) as InstitutionAccount[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return parsed
      .map((a) => ({
        institutionId: String(a.institutionId ?? '').toUpperCase(),
        displayName: String(a.displayName ?? a.institutionId ?? 'Institution'),
        token: String(a.token ?? ''),
        allowlisted: a.allowlisted !== false,
        role: normalizeRole((a as { role?: string }).role),
      }))
      .filter((a) => a.institutionId && a.token);
  } catch {
    return [];
  }
}

function allowDemoInstitutions(): boolean {
  const flag = process.env.AST_ALLOW_DEMO;
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  // Default: demo only outside production
  return (process.env.NODE_ENV ?? 'development') !== 'production';
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
