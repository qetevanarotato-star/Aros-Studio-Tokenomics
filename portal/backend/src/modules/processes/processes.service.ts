import { Injectable } from '@nestjs/common';
import {
  makeProcessId,
  payloadFingerprint,
  validateCreateProcess,
  isValidDocumentPackageHash,
  type AttachDocumentsBody,
  type CreateProcessBody,
  type PortalErrorBody,
  type ProcessRecord,
} from '../../common/shared-bridge';
import { CoreApiClient } from '../../common/core-client';
import { EdgeProcessStore } from './edge-process-store';

export interface CreateResult {
  statusCode: number;
  body: Record<string, unknown>;
}

/**
 * Portal edge process service for institutional clients.
 * Validates admission, tracks edge history, hands off to Core Orchestrator.
 * Edge index is file-persisted (not NodeChain SoT).
 */
@Injectable()
export class ProcessesService {
  private readonly byId = new Map<string, ProcessRecord>();
  private readonly byIdem = new Map<string, { processId: string; fingerprint: string }>();
  private readonly core: CoreApiClient;
  private readonly store: EdgeProcessStore;

  constructor(core?: CoreApiClient, store?: EdgeProcessStore) {
    this.core = core ?? new CoreApiClient();
    this.store = store ?? new EdgeProcessStore();
    this.hydrateFromDisk();
  }

  private hydrateFromDisk(): void {
    const snap = this.store.load();
    for (const rec of snap.processes) {
      this.byId.set(rec.processId, rec);
    }
    for (const row of snap.idempotency) {
      this.byIdem.set(row.scope, {
        processId: row.processId,
        fingerprint: row.fingerprint,
      });
    }
  }

  private persist(): void {
    this.store.save({
      version: 1,
      processes: [...this.byId.values()],
      idempotency: [...this.byIdem.entries()].map(([scope, v]) => ({
        scope,
        processId: v.processId,
        fingerprint: v.fingerprint,
      })),
    });
  }

  listForInstitution(
    institutionId: string,
    opts?: { status?: string; limit?: number },
  ): ProcessRecord[] {
    return this.listForActor(institutionId, 'institution', opts);
  }

  /**
   * Two-sided visibility:
   * - operator → all edge processes
   * - holder → holderId matches account id
   * - else → owner institutionId OR counterpartyIds includes account
   */
  listForActor(
    institutionId: string,
    role: string,
    opts?: { status?: string; limit?: number },
  ): ProcessRecord[] {
    const inst = institutionId.toUpperCase();
    const r = (role || 'institution').toLowerCase();
    let rows = [...this.byId.values()].filter((rec) =>
      this.canAccessRecord(rec, inst, r),
    );
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (opts?.status?.trim()) {
      const st = opts.status.trim().toLowerCase();
      rows = rows.filter((row) => row.status.toLowerCase() === st);
    }
    if (opts?.limit && opts.limit > 0) {
      rows = rows.slice(0, opts.limit);
    }
    return rows;
  }

  canAccessRecord(
    rec: ProcessRecord,
    institutionId: string,
    role: string,
  ): boolean {
    const inst = institutionId.toUpperCase();
    const r = (role || 'institution').toLowerCase();
    if (r === 'operator') return true;
    if (rec.institutionId.toUpperCase() === inst) return true;
    const cps = (rec.counterpartyIds ?? []).map((x) => x.toUpperCase());
    if (cps.includes(inst)) return true;
    if (r === 'holder' && rec.holderId.toUpperCase() === inst) return true;
    return false;
  }

  assertAccess(
    processId: string,
    institutionId: string,
    role: string,
  ): { ok: true; rec: ProcessRecord } | { ok: false; statusCode: number; body: Record<string, unknown> } {
    const rec = this.byId.get(processId);
    if (!rec) {
      return {
        ok: false,
        statusCode: 404,
        body: { code: 'NOT_FOUND', message: `process not found on edge: ${processId}` },
      };
    }
    if (!this.canAccessRecord(rec, institutionId, role)) {
      return {
        ok: false,
        statusCode: 403,
        body: { code: 'FORBIDDEN', message: 'process not visible to this party' },
      };
    }
    return { ok: true, rec };
  }

  /**
   * Invite a second institution onto the process (two-sided pilot).
   * Owner only (or operator).
   */
  inviteCounterparty(
    processId: string,
    ownerInstitutionId: string,
    role: string,
    counterpartyInstitutionId: string,
    isAllowlisted: (id: string) => boolean,
  ): CreateResult {
    const rec = this.byId.get(processId);
    if (!rec) {
      return {
        statusCode: 404,
        body: { code: 'NOT_FOUND', message: `process not found: ${processId}` },
      };
    }
    const owner = ownerInstitutionId.toUpperCase();
    const r = (role || 'institution').toLowerCase();
    if (r !== 'operator' && rec.institutionId.toUpperCase() !== owner) {
      return {
        statusCode: 403,
        body: { code: 'FORBIDDEN', message: 'only process owner (or operator) can invite' },
      };
    }
    const cp = counterpartyInstitutionId.trim().toUpperCase();
    if (!cp) {
      return {
        statusCode: 400,
        body: { code: 'VALIDATION_ERROR', message: 'counterpartyInstitutionId required' },
      };
    }
    if (cp === rec.institutionId.toUpperCase()) {
      return {
        statusCode: 400,
        body: { code: 'VALIDATION_ERROR', message: 'cannot invite owner as counterparty' },
      };
    }
    if (!isAllowlisted(cp)) {
      return {
        statusCode: 400,
        body: {
          code: 'VALIDATION_ERROR',
          message: `counterparty not allowlisted: ${cp}`,
        },
      };
    }
    const list = new Set((rec.counterpartyIds ?? []).map((x) => x.toUpperCase()));
    list.add(cp);
    rec.counterpartyIds = [...list];
    rec.updatedAt = new Date().toISOString();
    this.persist();
    return {
      statusCode: 200,
      body: {
        processId: rec.processId,
        institutionId: rec.institutionId,
        counterpartyIds: rec.counterpartyIds,
        message: 'counterparty invited — they can open this process after login',
      },
    };
  }

  attachFiatEvidence(
    processId: string,
    item: {
      provider: string;
      reference: string;
      status: string;
      amount?: string;
      currency?: string;
    },
  ): CreateResult {
    const rec = this.byId.get(processId);
    if (!rec) {
      return {
        statusCode: 404,
        body: { code: 'NOT_FOUND', message: `process not found: ${processId}` },
      };
    }
    const entry = {
      provider: item.provider.trim() || 'sandbox-bank',
      reference: item.reference.trim(),
      status: item.status.trim() || 'settled',
      amount: item.amount?.trim(),
      currency: item.currency?.trim()?.toUpperCase(),
      receivedAt: new Date().toISOString(),
    };
    if (!entry.reference) {
      return {
        statusCode: 400,
        body: { code: 'VALIDATION_ERROR', message: 'reference required' },
      };
    }
    rec.fiatEvidence = [...(rec.fiatEvidence ?? []), entry];
    rec.updatedAt = new Date().toISOString();
    this.persist();
    return {
      statusCode: 200,
      body: {
        processId: rec.processId,
        fiatEvidence: rec.fiatEvidence,
        message:
          'fiat evidence attached on edge (sandbox) — not PoT, not mint, not SoT',
      },
    };
  }

  listAllEdge(opts?: { limit?: number }): ProcessRecord[] {
    let rows = [...this.byId.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    if (opts?.limit && opts.limit > 0) rows = rows.slice(0, opts.limit);
    return rows;
  }

  /** Dashboard KPIs for the actor (edge-tracked only). */
  statsForInstitution(institutionId: string, role = 'institution'): {
    institutionId: string;
    role: string;
    total: number;
    byStatus: Record<string, number>;
    lastSubmittedAt: string | null;
    submittedToCore: number;
    awaitingCore: number;
  } {
    const rows = this.listForActor(institutionId, role);
    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    }
    return {
      institutionId: institutionId.toUpperCase(),
      role,
      total: rows.length,
      byStatus,
      lastSubmittedAt: rows[0]?.createdAt ?? null,
      submittedToCore: byStatus['submitted_to_core'] ?? 0,
      awaitingCore: byStatus['awaiting_core'] ?? 0,
    };
  }

  async create(
    body: CreateProcessBody,
    institutionId: string | undefined,
    idempotencyKey: string | undefined,
    institutionToken?: string,
  ): Promise<CreateResult> {
    const err = validateCreateProcess(body, idempotencyKey, institutionId);
    if (err) return this.error(err, err.code === 'FORBIDDEN' ? 403 : 422);

    const inst = institutionId!.trim().toUpperCase();
    const key = idempotencyKey!.trim();
    const fingerprint = payloadFingerprint({
      processType: body.processType,
      valuation: body.valuation,
      holderId: body.holderId,
      assetId: body.assetId,
      hasQualifiedSignature: body.hasQualifiedSignature,
      documentPackageHash: body.documentPackageHash.toLowerCase(),
      note: body.note,
    });

    const idemScope = `${inst}::${key}`;
    const existing = this.byIdem.get(idemScope);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return this.error(
          {
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            message: 'Idempotency-Key reused with different payload',
          },
          409,
        );
      }
      const rec = this.byId.get(existing.processId)!;
      return {
        statusCode: 202,
        body: this.toAccepted(rec, 'duplicate'),
      };
    }

    const processId = body.processId?.trim() || makeProcessId(inst);
    if (this.byId.has(processId)) {
      return this.error(
        {
          code: 'VALIDATION_ERROR',
          message: `processId already exists on edge: ${processId}`,
        },
        409,
      );
    }

    const now = new Date().toISOString();
    // Core money helpers expect up to 9 decimal places; normalize bare integers
    const valuationNorm = normalizeValuation(body.valuation.trim());
    const rec: ProcessRecord = {
      processId,
      institutionId: inst,
      processType: body.processType,
      status: 'awaiting_core',
      valuation: valuationNorm,
      valuationCurrency: body.valuationCurrency?.trim().toUpperCase() || undefined,
      amountFromDocument: body.amountFromDocument?.trim() || undefined,
      institutionalAroPerUnit: body.institutionalAroPerUnit?.trim() || undefined,
      holderId: body.holderId.trim(),
      assetId: body.assetId,
      holderWallet: body.holderWallet?.trim() || undefined,
      hasQualifiedSignature: true,
      documentPackageHash: body.documentPackageHash.toLowerCase(),
      idempotencyKey: key,
      payloadFingerprint: fingerprint,
      createdAt: now,
      updatedAt: now,
      note: body.note,
    };
    this.byId.set(processId, rec);
    this.byIdem.set(idemScope, { processId, fingerprint });
    this.persist();

    if (this.core.enabled) {
      const coreRes = await this.core.createProcess(
        {
          processType: body.processType,
          valuation: rec.valuation,
          holderId: rec.holderId,
          assetId: rec.assetId,
          processId,
          hasQualifiedSignature: true,
          documentPackageHash: rec.documentPackageHash,
          hasDocuments: true,
          institutionAllowlisted: true,
          note: body.note,
        },
        {
          institutionId: inst,
          idempotencyKey: key,
          institutionToken,
        },
      );

      if (coreRes.statusCode >= 200 && coreRes.statusCode < 300) {
        rec.status = 'submitted_to_core';
        rec.updatedAt = new Date().toISOString();
        this.persist();
        const coreBody = coreRes.body as Record<string, unknown>;
        return {
          statusCode: 202,
          body: this.enrichProgress({
            ...this.toAccepted(rec, 'submitted_to_core'),
            ...coreBody,
            status:
              coreBody.status === 'completed' || coreBody.mint
                ? 'completed'
                : 'submitted_to_core',
            source: 'core',
            core: coreBody,
            message: 'Submitted to Core Orchestrator — mint only after PoT on core',
          }),
        };
      }

      rec.status = 'awaiting_core';
      rec.updatedAt = new Date().toISOString();
      this.persist();
      return {
        statusCode: 202,
        body: this.enrichProgress({
          ...this.toAccepted(rec, 'awaiting_core'),
          source: 'edge',
          coreError: coreRes.body,
          message:
            'Accepted at edge; Core unavailable — no mint from portal (retry later)',
        }),
      };
    }

    return {
      statusCode: 202,
      body: this.enrichProgress({
        ...this.toAccepted(rec, 'awaiting_core'),
        source: 'edge',
      }),
    };
  }

  /**
   * Retry Core hand-off OR continue stuck Core pipeline (awaiting_pot → mint).
   */
  async retryHandoff(
    processId: string,
    institutionId: string | undefined,
    institutionToken?: string,
  ): Promise<CreateResult> {
    const rec = this.byId.get(processId);
    if (!rec) {
      return this.error(
        { code: 'NOT_FOUND', message: `unknown process ${processId}` },
        404,
      );
    }
    if (institutionId && rec.institutionId.toUpperCase() !== institutionId.toUpperCase()) {
      return this.error({ code: 'FORBIDDEN', message: 'institution mismatch' }, 403);
    }
    if (!this.core.enabled) {
      return {
        statusCode: 202,
        body: this.enrichProgress({
          ...this.toAccepted(rec, rec.status),
          source: 'edge',
          message: 'Core hand-off disabled',
        }),
      };
    }

    // If already on Core, try continue (PoT → mint) for stuck awaiting_pot
    if (rec.status === 'submitted_to_core' || rec.status === 'awaiting_core') {
      const cont = await this.core.continueProcess(processId, {
        institutionId: rec.institutionId,
        institutionToken,
      });
      if (cont.statusCode >= 200 && cont.statusCode < 300) {
        rec.status = 'submitted_to_core';
        rec.updatedAt = new Date().toISOString();
        this.persist();
        const coreBody = cont.body as Record<string, unknown>;
        return {
          statusCode: 200,
          body: this.enrichProgress({
            ...this.toAccepted(rec, 'submitted_to_core'),
            ...coreBody,
            status:
              coreBody.status === 'completed' || coreBody.mint || coreBody.mintAmount
                ? 'completed'
                : String(coreBody.status ?? 'submitted_to_core'),
            source: 'core',
            core: coreBody,
            message: 'Continued Core pipeline (PoT / mint)',
          }),
        };
      }
      // If continue failed because process unknown, fall through to create
      const contErr = cont.body as { code?: string };
      if (contErr.code !== 'ORCH_NOT_FOUND' && cont.statusCode !== 404) {
        // still try create for awaiting_core; for submitted try report continue error
        if (rec.status === 'submitted_to_core') {
          return {
            statusCode: 202,
            body: this.enrichProgress({
              ...(await this.get(processId, institutionId, institutionToken)).body,
              coreError: cont.body,
              message: 'Continue on Core failed — see coreError',
            }),
          };
        }
      }
    }

    if (rec.status === 'submitted_to_core') {
      // Refresh from core
      return this.get(processId, institutionId, institutionToken);
    }

    const coreRes = await this.core.createProcess(
      {
        processType: rec.processType,
        valuation: rec.valuation,
        holderId: rec.holderId,
        assetId: rec.assetId,
        processId: rec.processId,
        hasQualifiedSignature: true,
        documentPackageHash: rec.documentPackageHash,
        hasDocuments: true,
        institutionAllowlisted: true,
        note: rec.note,
      },
      {
        institutionId: rec.institutionId,
        idempotencyKey: rec.idempotencyKey,
        institutionToken,
      },
    );
    if (coreRes.statusCode >= 200 && coreRes.statusCode < 300) {
      rec.status = 'submitted_to_core';
      rec.updatedAt = new Date().toISOString();
      this.persist();
      const coreBody = coreRes.body as Record<string, unknown>;
      return {
        statusCode: 202,
        body: this.enrichProgress({
          ...this.toAccepted(rec, 'submitted_to_core'),
          ...coreBody,
          status:
            coreBody.status === 'completed' || coreBody.mint
              ? 'completed'
              : 'submitted_to_core',
          source: 'core',
          core: coreBody,
          message: 'Retry succeeded — submitted to Core Orchestrator',
        }),
      };
    }
    rec.updatedAt = new Date().toISOString();
    this.persist();
    return {
      statusCode: 202,
      body: this.enrichProgress({
        ...this.toAccepted(rec, 'awaiting_core'),
        source: 'edge',
        coreError: coreRes.body,
        message: 'Retry failed — Core still unavailable; no mint from portal',
      }),
    };
  }

  /**
   * Public read-only lookup (no session). Redacted — for external transparency.
   */
  async getPublic(processId: string): Promise<CreateResult> {
    const full = await this.get(processId, undefined, undefined);
    if (full.statusCode >= 400) return full;
    return {
      statusCode: 200,
      body: this.toPublicView(full.body, processId),
    };
  }

  /**
   * Digitization / registration certificate for the institution.
   * Edge attestation of process state; economic finality only when Core/PoT/mint present.
   */
  async getCertificate(
    processId: string,
    institutionId: string | undefined,
    institutionToken?: string,
    role = 'institution',
  ): Promise<CreateResult> {
    const full =
      institutionId != null && institutionId !== ''
        ? await this.getWithRole(processId, institutionId, role, institutionToken)
        : await this.get(processId, institutionId, institutionToken);
    if (full.statusCode >= 400) return full;
    const b = full.body;
    const edge = b.edge as Record<string, unknown> | undefined;
    const valuation = String(
      b.valuation ?? edge?.valuation ?? b.mintAmount ?? '—',
    );
    const potVerified = b.potVerified === 1 || b.verified === 1 ? 1 : 0;
    const mintAmount =
      b.mintAmount != null
        ? String(b.mintAmount)
        : (b.mint as { amount?: string } | undefined)?.amount != null
          ? String((b.mint as { amount?: string }).amount)
          : null;
    const status = String(b.status ?? edge?.status ?? 'unknown');
    const handedOff =
      status === 'submitted_to_core' ||
      status === 'completed' ||
      b.source === 'core' ||
      potVerified === 1;

    const pid = String(b.processId ?? processId);
    const holderWallet =
      (b.holderWallet as string | null | undefined) ??
      (edge?.holderWallet as string | null | undefined) ??
      null;
    const publicOrigin = (process.env.AST_PUBLIC_PORTAL_ORIGIN ?? '').replace(/\/$/, '');
    const publicLookupPath = `/explore?processId=${encodeURIComponent(pid)}`;
    const nodechainPath = `/nodechain?processId=${encodeURIComponent(pid)}`;
    const verifyUrl = publicOrigin
      ? `${publicOrigin}${publicLookupPath}`
      : publicLookupPath;

    // Wallet-compatible payload (representation layer — ERC balances are NOT SoT)
    const walletCompat = buildWalletCompatPackage({
      processId: pid,
      institutionId: String(b.institutionId ?? edge?.institutionId ?? institutionId ?? ''),
      holderId: String(b.holderId ?? edge?.holderId ?? ''),
      holderWallet,
      assetId: (b.assetId ?? edge?.assetId ?? null) as string | null,
      valuation,
      mintAmountAro: mintAmount,
      documentPackageHash: String(
        b.documentPackageHash ?? edge?.documentPackageHash ?? '',
      ),
      potVerified,
      status,
      verifyUrl,
      issuedAt: new Date().toISOString(),
    });

    const certificate = {
      documentType: 'AST_DIGITIZATION_CERTIFICATE',
      title: 'Certificate of asset digitization and process registration',
      version: '1.1',
      processId: pid,
      institutionId: b.institutionId ?? edge?.institutionId ?? institutionId,
      holderId: b.holderId ?? edge?.holderId,
      holderWallet,
      assetId: b.assetId ?? edge?.assetId ?? null,
      institutionalValuation: valuation,
      valuationCurrency:
        (b.valuationCurrency as string | null | undefined) ??
        (edge?.valuationCurrency as string | null | undefined) ??
        null,
      amountFromDocument:
        (b.amountFromDocument as string | null | undefined) ??
        (edge?.amountFromDocument as string | null | undefined) ??
        null,
      institutionalAroPerUnit:
        (b.institutionalAroPerUnit as string | null | undefined) ??
        (edge?.institutionalAroPerUnit as string | null | undefined) ??
        null,
      mintAmountAro: mintAmount,
      documentPackageHash:
        b.documentPackageHash ?? edge?.documentPackageHash ?? null,
      hasQualifiedSignature:
        b.hasQualifiedSignature ?? edge?.hasQualifiedSignature ?? true,
      potVerified,
      status,
      source: b.source ?? 'edge',
      pipeline: {
        documentsAdmitted: true,
        electronicSignatureConfirmed: true,
        handedOffToCore: handedOff,
        potComplete: potVerified === 1,
        economicMintRecorded: mintAmount != null,
      },
      statements: [
        'The institution submitted an evidence package with electronic signature attestation.',
        'Portal edge does not mint ARO and is not NodeChain source of truth.',
        handedOff
          ? 'Package was handed off to Core Orchestrator for PoT-gated processing.'
          : 'Package is admitted at edge; awaiting Core Orchestrator hand-off.',
        potVerified === 1
          ? 'Proof of Transaction verified=1 is recorded (or reported) for this process.'
          : 'PoT verification is pending or not yet visible on this status read.',
        mintAmount != null
          ? `Economic mint amount reported: ${mintAmount} ARO (Core journal is SoT).`
          : 'Mint amount not yet reported on this status view.',
        holderWallet
          ? `Bound representation wallet (non-SoT): ${holderWallet}`
          : 'No holder wallet bound — add 0x address for wallet-compatible certificate export.',
      ],
      issuedAt: new Date().toISOString(),
      createdAt: b.createdAt ?? edge?.createdAt ?? null,
      publicLookupPath,
      nodechainPath,
      qrVerifyPath: publicLookupPath,
      qrLabel: 'Scan to verify (wallet / browser)',
      /** Prefer encoding wallet-compat URI in QR when wallet is bound; else public verify URL */
      qrPayloadHint: holderWallet
        ? 'ast-certificate-v1 + eip681-style verify (see walletCompat)'
        : 'public verify URL',
      issuerName: 'Aros Studio Tokenomics (AST)',
      certificateSerial: `AST-CERT-${pid.replace(/^AST-/, '')}`,
      walletCompat,
      disclaimer:
        'This certificate is an institutional edge attestation. NodeChain + PoT remain SoT. ERC / wallet balances are representation only — not free mint authority. QR is wallet- and dApp-scannable for verification.',
    };

    return { statusCode: 200, body: certificate };
  }

  /**
   * Bind (or update) representation EVM wallet on edge process for certificate export.
   * Not SoT / not mint — MetaMask-style 0x address only.
   */
  bindHolderWallet(
    processId: string,
    institutionId: string,
    holderWalletRaw: string,
    role = 'institution',
  ): CreateResult {
    const access = this.assertAccess(processId, institutionId, role);
    if (!access.ok) {
      return { statusCode: access.statusCode, body: access.body };
    }
    const rec = access.rec;
    const r = (role || 'institution').toLowerCase();
    const isOwner = rec.institutionId.toUpperCase() === institutionId.toUpperCase();
    const isHolder =
      r === 'holder' && rec.holderId.toUpperCase() === institutionId.toUpperCase();
    if (r === 'counterparty' || (!isOwner && !isHolder && r !== 'operator')) {
      return {
        statusCode: 403,
        body: {
          code: 'FORBIDDEN',
          message: 'only owner, holder, or operator may bind wallet',
        },
      };
    }
    const wallet = holderWalletRaw.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return {
        statusCode: 400,
        body: {
          code: 'WALLET_INVALID',
          message: 'holderWallet must be 0x + 40 hex (EVM / MetaMask)',
        },
      };
    }
    rec.holderWallet = wallet;
    rec.updatedAt = new Date().toISOString();
    this.persist();
    return {
      statusCode: 200,
      body: {
        processId: rec.processId,
        holderWallet: wallet,
        message: 'wallet bound on edge for certificate / wallet-compat export (representation only)',
      },
    };
  }

  async get(
    processId: string,
    institutionId: string | undefined,
    institutionToken?: string,
  ): Promise<CreateResult> {
    if (this.core.enabled) {
      const coreRes = await this.core.getProcess(
        processId,
        institutionId,
        institutionToken,
      );
      if (coreRes.statusCode === 200) {
        const edge = this.byId.get(processId);
        if (edge) {
          edge.status = 'submitted_to_core';
          edge.updatedAt = new Date().toISOString();
          this.persist();
        }
        let body: Record<string, unknown> = {
          ...coreRes.body,
          source: 'core',
          edge: edge ? this.toStatus(edge) : undefined,
        };
        // Auto-continue stuck Core pipelines (timeout mid-request left awaiting_pot)
        const coreStatus = String(coreRes.body.status ?? '');
        const potOk = coreRes.body.potVerified === 1;
        const hasMint = coreRes.body.mintAmount != null;
        if (
          (coreStatus === 'awaiting_pot' || (coreStatus !== 'settled' && coreStatus !== 'closed' && coreStatus !== 'completed' && !hasMint)) &&
          !potOk &&
          !hasMint &&
          institutionId
        ) {
          const cont = await this.core.continueProcess(processId, {
            institutionId,
            institutionToken,
          });
          if (cont.statusCode >= 200 && cont.statusCode < 300) {
            body = {
              ...body,
              ...cont.body,
              source: 'core',
              status: cont.body.status ?? 'completed',
              edge: edge ? this.toStatus(edge) : undefined,
              autoContinued: true,
            };
          } else {
            body = {
              ...body,
              coreError: cont.body,
              continueAttempted: true,
            };
          }
        }
        return {
          statusCode: 200,
          body: this.enrichProgress(body),
        };
      }
      if (coreRes.statusCode === 404 && !this.byId.has(processId)) {
        return this.error(
          { code: 'NOT_FOUND', message: `unknown process ${processId}` },
          404,
        );
      }
    }

    const rec = this.byId.get(processId);
    if (!rec) {
      return this.error(
        { code: 'NOT_FOUND', message: `unknown process ${processId}` },
        404,
      );
    }
    // institutionId-only check kept for callers without role; prefer getWithRole
    if (
      institutionId &&
      rec.institutionId.toUpperCase() !== institutionId.toUpperCase() &&
      !(rec.counterpartyIds ?? [])
        .map((x) => x.toUpperCase())
        .includes(institutionId.toUpperCase()) &&
      rec.holderId.toUpperCase() !== institutionId.toUpperCase()
    ) {
      return this.error({ code: 'FORBIDDEN', message: 'institution mismatch' }, 403);
    }
    return {
      statusCode: 200,
      body: this.enrichProgress({ ...this.toStatus(rec), source: 'edge' }),
    };
  }

  async getWithRole(
    processId: string,
    institutionId: string,
    role: string,
    institutionToken?: string,
  ): Promise<CreateResult> {
    const access = this.assertAccess(processId, institutionId, role);
    if (!access.ok) {
      return { statusCode: access.statusCode, body: access.body };
    }
    // Access already enforced. Use owner id for Core token path (counterparties/ops may lack owner token).
    const ownerId = access.rec.institutionId;
    const tokenForCore =
      access.rec.institutionId.toUpperCase() === institutionId.toUpperCase()
        ? institutionToken
        : undefined;
    const full = await this.get(processId, ownerId, tokenForCore);
    if (full.statusCode >= 400) {
      // Still return edge view if Core missing
      return {
        statusCode: 200,
        body: this.enrichProgress({
          ...this.toStatus(access.rec),
          source: 'edge',
          coreError: full.body,
          access: {
            actorInstitutionId: institutionId.toUpperCase(),
            role,
            owner: ownerId,
            counterpartyIds: access.rec.counterpartyIds ?? [],
            relation: this.relationLabel(access.rec, institutionId, role),
          },
        }),
      };
    }
    return {
      statusCode: 200,
      body: {
        ...full.body,
        access: {
          actorInstitutionId: institutionId.toUpperCase(),
          role,
          owner: ownerId,
          counterpartyIds: access.rec.counterpartyIds ?? [],
          relation: this.relationLabel(access.rec, institutionId, role),
        },
      },
    };
  }

  private relationLabel(
    rec: ProcessRecord,
    institutionId: string,
    role: string,
  ): string {
    const inst = institutionId.toUpperCase();
    if ((role || '').toLowerCase() === 'operator') return 'operator';
    if (rec.institutionId.toUpperCase() === inst) return 'owner';
    if ((rec.counterpartyIds ?? []).map((x) => x.toUpperCase()).includes(inst)) {
      return 'counterparty';
    }
    if (rec.holderId.toUpperCase() === inst) return 'holder';
    return 'viewer';
  }

  /**
   * Normalize pipeline flags for the portal UI (progress bar + steps).
   */
  private enrichProgress(body: Record<string, unknown>): Record<string, unknown> {
    const edge = body.edge as Record<string, unknown> | undefined;
    const status = String(body.status ?? edge?.status ?? 'unknown');
    const source = String(body.source ?? 'edge');
    const potVerified =
      body.potVerified === 1 ||
      body.verified === 1 ||
      (body.verdict as { verified?: number } | undefined)?.verified === 1
        ? 1
        : 0;
    const mintAmount =
      body.mintAmount != null
        ? String(body.mintAmount)
        : (body.mint as { amount?: string } | undefined)?.amount != null
          ? String((body.mint as { amount: string }).amount)
          : null;
    const handedOff =
      source === 'core' ||
      status === 'submitted_to_core' ||
      status === 'completed' ||
      status === 'settled' ||
      status === 'pot_done' ||
      potVerified === 1 ||
      mintAmount != null;
    const potDone = potVerified === 1;
    const mintDone =
      mintAmount != null || status === 'settled' || status === 'completed';

    const steps = [
      {
        id: 'admitted',
        title: 'Admitted at edge',
        state: 'done' as const,
        detail: 'Package hash + e-sign attestation accepted',
      },
      {
        id: 'core',
        title: 'Core hand-off',
        state: handedOff ? ('done' as const) : status === 'awaiting_core' ? ('active' as const) : ('pending' as const),
        detail: handedOff
          ? 'Orchestrator received the process'
          : 'Waiting for Core — use Retry hand-off if Core was down',
      },
      {
        id: 'pot',
        title: 'PoT verification',
        state: potDone ? ('done' as const) : handedOff ? ('active' as const) : ('pending' as const),
        detail: potDone ? 'verified = 1 on NodeChain' : 'Proof of Transaction pending or not yet visible',
      },
      {
        id: 'mint',
        title: 'Economic settle (mint)',
        state: mintDone ? ('done' as const) : potDone ? ('active' as const) : ('pending' as const),
        detail: mintDone
          ? `Mint recorded: ${mintAmount ?? 'yes'} ARO`
          : 'Mint only after PoT (never on portal)',
      },
    ];
    const doneCount = steps.filter((s) => s.state === 'done').length;
    const percent = Math.round((doneCount / steps.length) * 100);
    const current =
      steps.find((s) => s.state === 'active') ??
      (mintDone ? steps[steps.length - 1] : steps.find((s) => s.state === 'pending') ?? steps[0]);

    const coreError = body.coreError as { code?: string; message?: string } | undefined;
    const failHint =
      !handedOff && coreError?.code
        ? ` Hand-off error: ${coreError.code}${coreError.message ? ` — ${coreError.message}` : ''}`
        : !handedOff
          ? ' Core may be down or institution not known to Core (PILOT/pilot). Restart stack with home-up.sh.'
          : '';

    return {
      ...body,
      potVerified,
      mintAmount: mintAmount ?? body.mintAmount ?? null,
      progress: {
        percent,
        currentStepId: current.id,
        currentTitle: current.title,
        currentDetail: current.detail + (coreError?.message ? ` (${coreError.message})` : ''),
        handedOff,
        potDone,
        mintDone,
        steps,
        message: mintDone
          ? 'Process complete on Core path'
          : handedOff
            ? `In progress: ${current.title}`
            : `Stuck at edge — Core hand-off not completed yet.${failHint}`,
        coreErrorCode: coreError?.code ?? null,
        coreErrorMessage: coreError?.message ?? null,
      },
    };
  }

  async attachDocuments(
    processId: string,
    body: AttachDocumentsBody,
    institutionId: string | undefined,
    idempotencyKey: string | undefined,
  ): Promise<CreateResult> {
    if (!idempotencyKey?.trim()) {
      return this.error(
        { code: 'IDEMPOTENCY_REQUIRED', message: 'Idempotency-Key required' },
        422,
      );
    }
    const rec = this.byId.get(processId);
    if (!rec) {
      return this.error(
        { code: 'NOT_FOUND', message: `unknown process ${processId}` },
        404,
      );
    }
    if (institutionId && rec.institutionId.toUpperCase() !== institutionId.toUpperCase()) {
      return this.error({ code: 'FORBIDDEN', message: 'institution mismatch' }, 403);
    }
    if (body.hasQualifiedSignature !== true) {
      return this.error(
        {
          code: 'MISSING_QUALIFIED_SIGNATURE',
          message: 'hasQualifiedSignature must be true',
        },
        422,
      );
    }
    if (!isValidDocumentPackageHash(body.documentPackageHash)) {
      return this.error(
        {
          code: 'MISSING_DOCUMENTS',
          message: 'documentPackageHash required (64 hex)',
        },
        422,
      );
    }
    rec.documentPackageHash = body.documentPackageHash.toLowerCase();
    rec.hasQualifiedSignature = true;
    rec.status = 'awaiting_core';
    rec.updatedAt = new Date().toISOString();
    this.persist();
    return { statusCode: 200, body: this.toStatus(rec) };
  }

  private toPublicView(
    body: Record<string, unknown>,
    processId: string,
  ): Record<string, unknown> {
    const edge = body.edge as Record<string, unknown> | undefined;
    const status = String(body.status ?? edge?.status ?? 'unknown');
    const valuation =
      body.valuation ?? edge?.valuation ?? body.mintAmount ?? undefined;
    const holderWallet =
      (body.holderWallet as string | null | undefined) ??
      (edge?.holderWallet as string | null | undefined) ??
      null;
    return {
      processId: body.processId ?? processId,
      status,
      source: body.source ?? 'edge',
      currentStep: status,
      valuation: valuation != null ? String(valuation) : undefined,
      processType: body.processType ?? edge?.processType,
      institutionId: body.institutionId ?? edge?.institutionId,
      holderWallet,
      documentPackageHash:
        body.documentPackageHash ?? edge?.documentPackageHash,
      potVerified: body.potVerified ?? body.verified ?? undefined,
      createdAt: body.createdAt ?? edge?.createdAt,
      updatedAt: body.updatedAt ?? edge?.updatedAt,
      public: true,
      note: 'Read-only public view. Portal does not mint. NodeChain is SoT after Core hand-off. holderWallet is representation only (not SoT mint).',
    };
  }

  private toAccepted(rec: ProcessRecord, status: string) {
    return {
      processId: rec.processId,
      idempotencyKey: rec.idempotencyKey,
      status,
      institutionId: rec.institutionId,
      valuation: rec.valuation,
      valuationCurrency: rec.valuationCurrency ?? null,
      amountFromDocument: rec.amountFromDocument ?? null,
      institutionalAroPerUnit: rec.institutionalAroPerUnit ?? null,
      holderId: rec.holderId,
      holderWallet: rec.holderWallet ?? null,
      hasQualifiedSignature: rec.hasQualifiedSignature,
      documentPackageHash: rec.documentPackageHash,
      message:
        status === 'submitted_to_core'
          ? 'Handed off to Core Orchestrator'
          : 'Accepted at edge; awaiting Core Orchestrator',
    };
  }

  private toStatus(rec: ProcessRecord) {
    return {
      processId: rec.processId,
      status: rec.status,
      processType: rec.processType,
      institutionId: rec.institutionId,
      valuation: rec.valuation,
      valuationCurrency: rec.valuationCurrency ?? null,
      amountFromDocument: rec.amountFromDocument ?? null,
      institutionalAroPerUnit: rec.institutionalAroPerUnit ?? null,
      holderId: rec.holderId,
      assetId: rec.assetId,
      holderWallet: rec.holderWallet ?? null,
      counterpartyIds: rec.counterpartyIds ?? [],
      fiatEvidence: rec.fiatEvidence ?? [],
      hasQualifiedSignature: rec.hasQualifiedSignature,
      documentPackageHash: rec.documentPackageHash,
      idempotencyKey: rec.idempotencyKey,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      note: rec.note,
    };
  }

  private error(body: PortalErrorBody, statusCode: number): CreateResult {
    return { statusCode, body: { ...body } };
  }
}

/** Ensure ARO decimal string (e.g. 150000 → 150000.000000000). */
function normalizeValuation(v: string): string {
  const t = v.trim();
  if (!/^-?\d+(\.\d{1,9})?$/.test(t)) return t;
  if (t.includes('.')) {
    const [w, f = ''] = t.split('.');
    return `${w}.${(f + '000000000').slice(0, 9)}`;
  }
  return `${t}.000000000`;
}

/**
 * Wallet / dApp compatible package (representation layer).
 * ERC-721-like metadata + EIP-681-style ethereum: URI for scanners.
 * Does NOT mint on-chain; adapters may later bridge SoT → chain.
 */
function buildWalletCompatPackage(input: {
  processId: string;
  institutionId: string;
  holderId: string;
  holderWallet: string | null;
  assetId: string | null;
  valuation: string;
  mintAmountAro: string | null;
  documentPackageHash: string;
  potVerified: 0 | 1;
  status: string;
  verifyUrl: string;
  issuedAt: string;
}) {
  const chainId = Number(process.env.AST_REPRESENTATION_CHAIN_ID ?? 1);
  const tokenView = (process.env.AST_ARO_VIEW_CONTRACT ?? '').trim() || null;
  const amount = input.mintAmountAro ?? input.valuation;
  const name = `AST Certificate ${input.processId}`;
  const description =
    'AST digitization certificate. Economic truth is NodeChain + PoT, not this NFT/metadata alone.';

  // ERC-721 / OpenSea-style metadata (wallets & marketplaces understand this shape)
  const erc721Metadata = {
    name,
    description,
    external_url: input.verifyUrl.startsWith('http')
      ? input.verifyUrl
      : undefined,
    image: undefined as string | undefined,
    attributes: [
      { trait_type: 'processId', value: input.processId },
      { trait_type: 'institutionId', value: input.institutionId },
      { trait_type: 'holderId', value: input.holderId },
      { trait_type: 'assetId', value: input.assetId ?? '' },
      { trait_type: 'valuationARO', value: input.valuation },
      { trait_type: 'mintAmountARO', value: input.mintAmountAro ?? '' },
      { trait_type: 'documentPackageHash', value: input.documentPackageHash },
      { trait_type: 'potVerified', value: input.potVerified },
      { trait_type: 'status', value: input.status },
      { trait_type: 'standard', value: 'AST-Token-Protocol / representation' },
    ],
  };

  // EIP-681-like deep link (Metamask etc. parse ethereum: URIs)
  // pay-style: ethereum:<address>@<chainId>/transfer?address=&uint256=
  // Without deployed adapter we encode verify + optional payment address binding
  const eip681 =
    input.holderWallet != null
      ? `ethereum:${input.holderWallet}@${chainId}`
      : null;

  // CAIP-19 style asset id for multi-chain wallets (abstract until adapter live)
  const caip19 = tokenView
    ? `eip155:${chainId}/erc20:${tokenView}`
    : `ast:nodechain/process:${input.processId}`;

  // Compact URI for QR (wallet or browser)
  const astUri = `ast://certificate/v1?processId=${encodeURIComponent(input.processId)}&hash=${encodeURIComponent(input.documentPackageHash)}&verify=${encodeURIComponent(input.verifyUrl)}`;

  return {
    schema: 'ast-wallet-compat-1',
    soT: 'NodeChain + PoT (not ERC balance)',
    representationOnly: true,
    chainId,
    caip2: `eip155:${chainId}`,
    caip19,
    holderWallet: input.holderWallet,
    eip681,
    astUri,
    erc721Metadata,
    /** Suggested amount string for wallet display (9 decimals ARO) */
    amountAro: amount,
    decimals: 9,
    symbol: 'ARO',
    name: 'ArosCoin (AST Token Protocol)',
    standards: ['AST-Token-Protocol', 'ERC-721-metadata', 'EIP-681', 'CAIP-19'],
    adapters: {
      erc20View: tokenView,
      note:
        'On-chain ARO view / ERC-3643 adapters are representation plugins. Deploy contracts separately; do not treat chain balance as SoT.',
    },
    issuedAt: input.issuedAt,
  };
}
