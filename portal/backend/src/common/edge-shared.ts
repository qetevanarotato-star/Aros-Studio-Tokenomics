/**
 * In-tree edge helpers aligned with Core processId / money rules.
 * Canonical package also lives at portal/shared (same API) for OpenAPI consumers.
 */
import { createHash, randomUUID } from 'crypto';

export const PROCESS_ID_RE = /^AST-[A-Z0-9]+-\d{8}-[A-Z0-9]+$/i;
export const AMOUNT_RE = /^-?\d+(\.\d{1,9})?$/;
export const HASH_RE = /^[a-f0-9]{64}$/i;
export const IDEMPOTENCY_KEY_MIN = 8;
export const IDEMPOTENCY_KEY_MAX = 128;

export type ProcessTypeId =
  | 'primary_tokenization'
  | 'revaluation'
  | 'ownership_transfer';

export type EdgeProcessStatus =
  | 'accepted'
  | 'awaiting_core'
  | 'documents_pending'
  | 'submitted_to_core'
  | 'rejected'
  | 'duplicate';

export interface CreateProcessBody {
  processId?: string;
  processType: ProcessTypeId;
  /** ARO amount to mint on Core (network unit of account after institutional mapping). */
  valuation: string;
  /**
   * Currency as stated on the institutional document (USD, EUR, GEL, …).
   * Labels the source unit; not an FX market rate from AST.
   */
  valuationCurrency?: string;
  /** Numeric amount as printed on the document (before ARO mapping). */
  amountFromDocument?: string;
  /**
   * How many ARO per 1 unit of document currency (institutional declaration).
   * Default 1 = one-to-one of the document figure into ARO units.
   */
  institutionalAroPerUnit?: string;
  holderId: string;
  assetId?: string;
  /**
   * Optional EVM wallet (0x…) for representation / wallet-compat QR.
   * Not SoT — binding for adapters & certificate only.
   */
  holderWallet?: string;
  hasQualifiedSignature: boolean;
  documentPackageHash: string;
  note?: string;
}

export interface AttachDocumentsBody {
  documentPackageHash: string;
  hasQualifiedSignature: boolean;
  documentCount?: number;
}

/** Fiat/bank sandbox evidence on edge (not SoT, not mint). */
export interface FiatEvidenceItem {
  provider: string;
  reference: string;
  status: string;
  amount?: string;
  currency?: string;
  receivedAt: string;
}

export interface ProcessRecord {
  processId: string;
  institutionId: string;
  processType: ProcessTypeId;
  status: EdgeProcessStatus;
  valuation: string;
  valuationCurrency?: string;
  amountFromDocument?: string;
  institutionalAroPerUnit?: string;
  holderId: string;
  assetId?: string;
  /** Optional EVM address for wallet-compatible certificate / adapters */
  holderWallet?: string;
  /**
   * Two-sided pilot: other allowlisted institutions invited onto this process.
   * Owner remains institutionId; counterparties get read (and limited act) access.
   */
  counterpartyIds?: string[];
  /** Bank/PSP sandbox evidence attachments (phase F local). */
  fiatEvidence?: FiatEvidenceItem[];
  hasQualifiedSignature: boolean;
  documentPackageHash: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  createdAt: string;
  updatedAt: string;
  note?: string;
}

export type PortalErrorCode =
  | 'VALIDATION_ERROR'
  | 'MISSING_VALUATION'
  | 'MISSING_QUALIFIED_SIGNATURE'
  | 'MISSING_DOCUMENTS'
  | 'INVALID_PROCESS_ID'
  | 'IDEMPOTENCY_REQUIRED'
  | 'IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'NOT_FOUND'
  | 'FORBIDDEN';

export interface PortalErrorBody {
  code: PortalErrorCode;
  message: string;
  details?: string[];
}

export function makeProcessId(institutionId: string, date = new Date()): string {
  const inst =
    institutionId
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 16) || 'UNK';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  return `AST-${inst}-${y}${m}${d}-${suffix}`;
}

export function isValidProcessId(processId: string): boolean {
  return PROCESS_ID_RE.test(processId);
}

export function isValidIdempotencyKey(key: string | undefined | null): boolean {
  if (!key || typeof key !== 'string') return false;
  const t = key.trim();
  return t.length >= IDEMPOTENCY_KEY_MIN && t.length <= IDEMPOTENCY_KEY_MAX;
}

export function isValidValuation(valuation: unknown): valuation is string {
  return typeof valuation === 'string' && AMOUNT_RE.test(valuation.trim());
}

export function isValidDocumentPackageHash(hash: unknown): hash is string {
  return typeof hash === 'string' && HASH_RE.test(hash.trim());
}

export function payloadFingerprint(body: unknown): string {
  const canonical = JSON.stringify(sortKeys(body));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    if (o[k] === undefined) continue;
    out[k] = sortKeys(o[k]);
  }
  return out;
}

export function validateCreateProcess(
  body: CreateProcessBody,
  idempotencyKey: string | undefined,
  institutionId: string | undefined,
): PortalErrorBody | null {
  if (!institutionId?.trim()) {
    return { code: 'FORBIDDEN', message: 'X-Institution-Id required' };
  }
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return {
      code: 'IDEMPOTENCY_REQUIRED',
      message: 'Idempotency-Key header required (8–128 chars)',
    };
  }
  if (!body?.processType) {
    return { code: 'VALIDATION_ERROR', message: 'processType required' };
  }
  if (!isValidValuation(body.valuation)) {
    return {
      code: 'MISSING_VALUATION',
      message: 'institutional valuation required as decimal string (max 9 fraction digits)',
    };
  }
  if (body.hasQualifiedSignature !== true) {
    return {
      code: 'MISSING_QUALIFIED_SIGNATURE',
      message: 'hasQualifiedSignature must be true (qualified institutional signature)',
    };
  }
  if (!isValidDocumentPackageHash(body.documentPackageHash)) {
    return {
      code: 'MISSING_DOCUMENTS',
      message: 'documentPackageHash required (64 hex SHA-256 of package)',
    };
  }
  if (!body.holderId?.trim()) {
    return { code: 'VALIDATION_ERROR', message: 'holderId required' };
  }
  if (body.holderWallet?.trim() && !isValidEvmAddress(body.holderWallet.trim())) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'holderWallet must be a valid EVM address (0x + 40 hex)',
    };
  }
  if (body.processId && !isValidProcessId(body.processId)) {
    return {
      code: 'INVALID_PROCESS_ID',
      message: 'processId must match AST-{INST}-{YYYYMMDD}-{suffix}',
    };
  }
  return null;
}

/** EVM address 0x + 40 hex (checksum not required). */
export function isValidEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
}
