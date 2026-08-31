import { randomUUID } from 'crypto';
import { NodechainService } from '../nodechain/nodechain.service';
import { parseAro, formatAro } from '../common/money';
import { resolveOkToEmit } from '../invariants';
import { TokenError, TokenErrorCode } from './errors';
import { computeRevaluationSupply, proRataAllocate } from './supply';
import {
  ARO_DECIMALS,
  ARO_SYMBOL,
  TOKEN_SCHEMA,
  type BurnResult,
  type MintResult,
  type RevaluationResult,
  type TokenSnapshot,
  type TransferResult,
} from './types';

/**
 * Layer 05 — AST Token Protocol (canonical balances on NodeChain facts).
 * Mint / burn / transfer / revaluation only after PoT verified=1.
 * No privileged free mint.
 */
export class TokenService {
  private balances = new Map<string, bigint>();
  private mintedProcess = new Set<string>();
  private remintedProcess = new Set<string>();
  private hydrated = false;

  constructor(private readonly nodechain: NodechainService) {}

  symbol(): string {
    return ARO_SYMBOL;
  }

  decimals(): number {
    return ARO_DECIMALS;
  }

  balanceOf(holderId: string): string {
    return formatAro(this.balances.get(holderId) ?? 0n);
  }

  totalSupply(): string {
    let s = 0n;
    for (const v of this.balances.values()) s += v;
    return formatAro(s);
  }

  snapshot(): TokenSnapshot {
    const holders = [...this.balances.entries()]
      .filter(([, b]) => b > 0n)
      .map(([holderId, b]) => ({ holderId, balance: formatAro(b) }))
      .sort((a, b) => a.holderId.localeCompare(b.holderId));
    return {
      symbol: ARO_SYMBOL,
      decimals: ARO_DECIMALS,
      totalSupply: this.totalSupply(),
      holders,
      mintedProcessIds: [...this.mintedProcess].sort(),
    };
  }

  /**
   * Rebuild balances from journal mint/burn/transfer/revaluation facts.
   * SoT remains NodeChain — memory is a working projection.
   */
  async hydrateFromJournal(): Promise<{ facts: number }> {
    const all = await this.nodechain.listAll();
    this.balances.clear();
    this.mintedProcess.clear();
    let facts = 0;
    for (const r of all) {
      if (r.recordType === 'mint_fact') {
        const holderId = String(r.payload.holderId ?? '');
        const amount = String(r.payload.amount ?? '0');
        const processId = r.processId ?? '';
        if (holderId && processId) {
          this.credit(holderId, parseAro(amount));
          this.mintedProcess.add(processId);
          facts += 1;
        }
      } else if (r.recordType === 'burn_fact') {
        const holderId = String(r.payload.holderId ?? '');
        const amount = String(r.payload.amount ?? '0');
        if (holderId) {
          this.debit(holderId, parseAro(amount));
          facts += 1;
        }
      } else if (r.recordType === 'transfer_fact') {
        const from = String(r.payload.fromHolderId ?? '');
        const to = String(r.payload.toHolderId ?? '');
        const amount = String(r.payload.amount ?? '0');
        if (from && to) {
          const arx = parseAro(amount);
          this.debit(from, arx);
          this.credit(to, arx);
          facts += 1;
        }
      } else if (r.recordType === 'revaluation_fact') {
        const allocations = r.payload.allocations as
          | Array<{ holderId: string; delta: string }>
          | undefined;
        if (Array.isArray(allocations)) {
          for (const a of allocations) {
            const d = parseAro(a.delta);
            if (d >= 0n) this.credit(a.holderId, d);
            else this.debit(a.holderId, -d);
          }
          facts += 1;
        }
      }
    }
    this.hydrated = true;
    return { facts };
  }

  async mintAfterPot(input: {
    processId: string;
    holderId: string;
    amount: string;
    potVerified: 0 | 1;
    potLedgerHeight: number;
    claimId?: string;
  }): Promise<MintResult> {
    this.assertProcess(input.processId);
    this.assertHolder(input.holderId);
    // Fail-closed: journal-backed ok-to-emit (P1–P4 + verified=1 + write-ahead), not caller trust alone
    let gate;
    try {
      gate = await resolveOkToEmit(this.nodechain, input.processId);
    } catch (e) {
      throw new TokenError(
        TokenErrorCode.MINT_WITHOUT_POT,
        e instanceof Error ? e.message : 'mint forbidden: ok-to-emit failed',
      );
    }
    if (input.potVerified !== 1) {
      throw new TokenError(TokenErrorCode.MINT_WITHOUT_POT, 'mint forbidden: pot verified != 1');
    }
    if (input.potLedgerHeight >= 0 && input.potLedgerHeight !== gate.potLedgerHeight) {
      throw new TokenError(
        TokenErrorCode.POT_HEIGHT_REQUIRED,
        `potLedgerHeight mismatch journal=${gate.potLedgerHeight} caller=${input.potLedgerHeight}`,
      );
    }
    const potLedgerHeight = gate.potLedgerHeight;
    await this.ensureHydrated();
    if (this.mintedProcess.has(input.processId) || (await this.journalHasMint(input.processId))) {
      throw new TokenError(TokenErrorCode.DOUBLE_MINT, 'double mint forbidden for process');
    }
    const arx = this.parsePositive(input.amount);
    const claimId = input.claimId ?? `claim-${randomUUID()}`;

    this.credit(input.holderId, arx);
    this.mintedProcess.add(input.processId);

    const r = await this.nodechain.append({
      clientRecordId: `mint:${input.processId}`,
      recordType: 'mint_fact',
      processId: input.processId,
      payload: {
        schemaVersion: TOKEN_SCHEMA,
        symbol: ARO_SYMBOL,
        decimals: ARO_DECIMALS,
        claimId,
        holderId: input.holderId,
        amount: formatAro(arx),
        potLedgerHeight,
        potVerified: 1,
        criteriaResult: gate.criteriaResult,
        okToEmit: true,
      },
      writerId: 'token',
      writerRole: 'token',
    });

    return {
      processId: input.processId,
      claimId,
      holderId: input.holderId,
      amount: formatAro(arx),
      potLedgerHeight,
      ledgerHeight: r.height,
      recordId: r.recordId,
      totalSupply: this.totalSupply(),
    };
  }

  /**
   * Remint after partial-release burn on the same processId.
   * Requires journal ok-to-emit + prior burn_fact; not a free mint.
   */
  async remintAfterPartialRelease(input: {
    processId: string;
    holderId: string;
    amount: string;
    potLedgerHeight: number;
    claimId?: string;
  }): Promise<MintResult> {
    this.assertProcess(input.processId);
    this.assertHolder(input.holderId);
    let gate;
    try {
      gate = await resolveOkToEmit(this.nodechain, input.processId);
    } catch (e) {
      throw new TokenError(
        TokenErrorCode.MINT_WITHOUT_POT,
        e instanceof Error ? e.message : 'remint requires ok-to-emit',
      );
    }
    await this.ensureHydrated();
    const history = await this.nodechain.listByProcessId(input.processId);
    const hasBurn = history.some((r) => r.recordType === 'burn_fact');
    if (!hasBurn) {
      throw new TokenError(
        TokenErrorCode.INVALID_PROCESS,
        'remint requires prior burn_fact on process',
      );
    }
    if (
      this.remintedProcess.has(input.processId) ||
      history.some(
        (r) => r.recordType === 'mint_fact' && r.payload?.kind === 'partial_release_remint',
      )
    ) {
      throw new TokenError(TokenErrorCode.DOUBLE_MINT, 'double remint forbidden for process');
    }
    const arx = this.parsePositive(input.amount);
    const claimId = input.claimId ?? `remint-${randomUUID()}`;
    this.credit(input.holderId, arx);
    this.remintedProcess.add(input.processId);

    const potLedgerHeight =
      input.potLedgerHeight >= 0 ? input.potLedgerHeight : gate.potLedgerHeight;
    const r = await this.nodechain.append({
      clientRecordId: `remint:${input.processId}`,
      recordType: 'mint_fact',
      processId: input.processId,
      payload: {
        schemaVersion: TOKEN_SCHEMA,
        symbol: ARO_SYMBOL,
        decimals: ARO_DECIMALS,
        claimId,
        holderId: input.holderId,
        amount: formatAro(arx),
        potLedgerHeight,
        potVerified: 1,
        kind: 'partial_release_remint',
        criteriaResult: gate.criteriaResult,
        okToEmit: true,
      },
      writerId: 'token',
      writerRole: 'token',
    });

    return {
      processId: input.processId,
      claimId,
      holderId: input.holderId,
      amount: formatAro(arx),
      potLedgerHeight,
      ledgerHeight: r.height,
      recordId: r.recordId,
      totalSupply: this.totalSupply(),
    };
  }

  async burn(input: {
    processId: string;
    holderId: string;
    amount: string;
    claimId?: string;
    /** If set, must be a revaluation/partial-release reason — never process close. */
    reason?: string;
  }): Promise<BurnResult> {
    const reason = (input.reason ?? '').toLowerCase();
    if (
      reason.includes('close') ||
      reason.includes('expir') ||
      reason.includes('extinguish') ||
      reason.includes('гасну')
    ) {
      throw new TokenError(
        TokenErrorCode.PROCESS_CLOSE_EXTINGUISH,
        'asset token is permanent: process close/expiry must not burn',
      );
    }
    this.assertProcess(input.processId);
    this.assertHolder(input.holderId);
    await this.ensureHydrated();
    const arx = this.parsePositive(input.amount);
    const prev = this.balances.get(input.holderId) ?? 0n;
    if (prev < arx) {
      throw new TokenError(TokenErrorCode.INSUFFICIENT_BALANCE, 'insufficient balance');
    }
    const claimId = input.claimId ?? `claim-${randomUUID()}`;
    this.debit(input.holderId, arx);

    const r = await this.nodechain.append({
      clientRecordId: `burn:${input.processId}:${claimId}`,
      recordType: 'burn_fact',
      processId: input.processId,
      payload: {
        schemaVersion: TOKEN_SCHEMA,
        claimId,
        holderId: input.holderId,
        amount: formatAro(arx),
      },
      writerId: 'token',
      writerRole: 'token',
    });

    return {
      processId: input.processId,
      claimId,
      holderId: input.holderId,
      amount: formatAro(arx),
      ledgerHeight: r.height,
      recordId: r.recordId,
      totalSupply: this.totalSupply(),
    };
  }

  /**
   * Internal transfer of rights representation — requires PoT verified=1 for the transfer process.
   */
  async transferAfterPot(input: {
    processId: string;
    fromHolderId: string;
    toHolderId: string;
    amount: string;
    potVerified: 0 | 1;
    potLedgerHeight: number;
    claimId?: string;
  }): Promise<TransferResult> {
    this.assertProcess(input.processId);
    this.assertHolder(input.fromHolderId);
    this.assertHolder(input.toHolderId);
    if (input.fromHolderId === input.toHolderId) {
      throw new TokenError(TokenErrorCode.INVALID_HOLDER, 'from and to must differ');
    }
    if (input.potVerified !== 1) {
      throw new TokenError(TokenErrorCode.TRANSFER_WITHOUT_POT, 'transfer requires pot verified=1');
    }
    await this.ensureHydrated();
    const arx = this.parsePositive(input.amount);
    const prev = this.balances.get(input.fromHolderId) ?? 0n;
    if (prev < arx) {
      throw new TokenError(TokenErrorCode.INSUFFICIENT_BALANCE, 'insufficient balance');
    }
    const claimId = input.claimId ?? `claim-${randomUUID()}`;
    this.debit(input.fromHolderId, arx);
    this.credit(input.toHolderId, arx);

    const r = await this.nodechain.append({
      clientRecordId: `transfer:${input.processId}`,
      recordType: 'transfer_fact',
      processId: input.processId,
      payload: {
        schemaVersion: TOKEN_SCHEMA,
        claimId,
        fromHolderId: input.fromHolderId,
        toHolderId: input.toHolderId,
        amount: formatAro(arx),
        potLedgerHeight: input.potLedgerHeight,
        potVerified: 1,
      },
      writerId: 'token',
      writerRole: 'token',
    });

    return {
      processId: input.processId,
      claimId,
      fromHolderId: input.fromHolderId,
      toHolderId: input.toHolderId,
      amount: formatAro(arx),
      potLedgerHeight: input.potLedgerHeight,
      ledgerHeight: r.height,
      recordId: r.recordId,
    };
  }

  /**
   * Confirmed ΔValue → pro-rata mint or burn (Canon §6.4 / §9.10).
   */
  async revalueAfterPot(input: {
    processId: string;
    previousValue: string;
    newValue: string;
    potVerified: 0 | 1;
    potLedgerHeight: number;
  }): Promise<RevaluationResult> {
    this.assertProcess(input.processId);
    if (input.potVerified !== 1) {
      throw new TokenError(
        TokenErrorCode.REVALUATION_WITHOUT_POT,
        'revaluation requires pot verified=1',
      );
    }
    await this.ensureHydrated();
    const supplyBefore = this.totalSupply();
    if (parseAro(supplyBefore) === 0n) {
      throw new TokenError(TokenErrorCode.ZERO_SUPPLY_REVAL, 'cannot revalue zero supply');
    }

    const { supplyAfter, deltaSupply, direction } = computeRevaluationSupply(
      supplyBefore,
      input.previousValue,
      input.newValue,
    );

    let allocations: Array<{ holderId: string; delta: string }> = [];
    if (direction === 'mint') {
      const parts = proRataAllocate(this.balances, parseAro(deltaSupply));
      for (const p of parts) {
        this.credit(p.holderId, p.delta);
        allocations.push({ holderId: p.holderId, delta: formatAro(p.delta) });
      }
    } else if (direction === 'burn') {
      const parts = proRataAllocate(this.balances, parseAro(deltaSupply));
      for (const p of parts) {
        this.debit(p.holderId, p.delta);
        allocations.push({ holderId: p.holderId, delta: formatAro(-p.delta) });
      }
    }

    const prevV = parseAro(input.previousValue);
    const newV = parseAro(input.newValue);
    const deltaValue = formatAro(newV - prevV);

    const r = await this.nodechain.append({
      clientRecordId: `reval:${input.processId}`,
      recordType: 'revaluation_fact',
      processId: input.processId,
      payload: {
        schemaVersion: TOKEN_SCHEMA,
        previousValue: formatAro(prevV),
        newValue: formatAro(newV),
        deltaValue,
        supplyBefore,
        supplyAfter: this.totalSupply(),
        direction,
        allocations,
        potLedgerHeight: input.potLedgerHeight,
        potVerified: 1,
      },
      writerId: 'token',
      writerRole: 'token',
    });

    return {
      processId: input.processId,
      previousValue: formatAro(prevV),
      newValue: formatAro(newV),
      deltaValue,
      supplyBefore,
      supplyAfter: this.totalSupply(),
      allocations,
      potLedgerHeight: input.potLedgerHeight,
      ledgerHeight: r.height,
      recordId: r.recordId,
    };
  }

  private async ensureHydrated(): Promise<void> {
    if (!this.hydrated) {
      await this.hydrateFromJournal();
    }
  }

  private async journalHasMint(processId: string): Promise<boolean> {
    const rows = await this.nodechain.listByProcessId(processId);
    return rows.some((r) => r.recordType === 'mint_fact');
  }

  private parsePositive(amount: string): bigint {
    try {
      const arx = parseAro(amount);
      if (arx <= 0n) {
        throw new TokenError(TokenErrorCode.INVALID_AMOUNT, 'amount must be positive');
      }
      return arx;
    } catch (e) {
      if (e instanceof TokenError) throw e;
      throw new TokenError(TokenErrorCode.INVALID_AMOUNT, String(e));
    }
  }

  private assertHolder(holderId: string): void {
    if (!holderId || !holderId.trim()) {
      throw new TokenError(TokenErrorCode.INVALID_HOLDER, 'holderId required');
    }
  }

  private assertProcess(processId: string): void {
    if (!processId || !processId.trim()) {
      throw new TokenError(TokenErrorCode.INVALID_PROCESS, 'processId required');
    }
  }

  private credit(holderId: string, arx: bigint): void {
    this.balances.set(holderId, (this.balances.get(holderId) ?? 0n) + arx);
  }

  private debit(holderId: string, arx: bigint): void {
    const prev = this.balances.get(holderId) ?? 0n;
    if (prev < arx) {
      throw new TokenError(TokenErrorCode.INSUFFICIENT_BALANCE, 'insufficient balance');
    }
    const next = prev - arx;
    if (next === 0n) this.balances.delete(holderId);
    else this.balances.set(holderId, next);
  }
}
