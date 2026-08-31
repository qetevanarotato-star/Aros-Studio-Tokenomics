import { NodechainService } from '../nodechain/nodechain.service';
import { EncodingService } from '../tx-encoding/encoding.service';
import { EncodingError } from '../tx-encoding/errors';
import type { ProcessTxBody } from '../tx-encoding/types';
import { ProcessError, ProcessErrorCode } from './errors';
import { assertTransition, isProcessStage, isTerminal } from './stages';
import {
  OPEN_COMPLETED_STAGES,
  type OpenProcessInput,
  type ProcessStage,
  type ProcessState,
  type StageTransitionEvent,
} from './types';

// Re-export types historically imported from process.service
export type { ProcessStage, ProcessState, OpenProcessInput, StageTransitionEvent } from './types';
export { ProcessError, ProcessErrorCode } from './errors';

/**
 * Layer 03 — process lifecycle state machine.
 * Owns stage transitions and process_* journal records.
 *
 * Does **not** mint, settle fees/commission, or evaluate PoT.
 * Orchestrator calls markPotDone / markSettled / abort after other layers.
 * `markSettled` = lifecycle stage only (not commission.settle).
 */
export class ProcessService {
  private readonly processes = new Map<string, ProcessState>();
  private readonly encoding: EncodingService;
  private readonly transitions: StageTransitionEvent[] = [];

  constructor(
    private readonly nodechain: NodechainService,
    encoding?: EncodingService,
  ) {
    this.encoding = encoding ?? new EncodingService();
  }

  get(processId: string): ProcessState | undefined {
    const p = this.processes.get(processId);
    return p ? this.clone(p) : undefined;
  }

  /** Snapshot of all in-memory processes (not full journal scan). */
  list(): ProcessState[] {
    return [...this.processes.values()].map((p) => this.clone(p));
  }

  listByStage(stage: ProcessStage): ProcessState[] {
    return this.list().filter((p) => p.stage === stage);
  }

  recentTransitions(limit = 50): StageTransitionEvent[] {
    return this.transitions.slice(-limit);
  }

  /**
   * Open process: encode payload → process_open → stage markers → awaiting_pot.
   */
  async open(input: OpenProcessInput): Promise<ProcessState> {
    if (!input.processId?.trim()) {
      throw new ProcessError(ProcessErrorCode.INVALID_INPUT, 'processId required');
    }
    if (!input.processType?.trim()) {
      throw new ProcessError(ProcessErrorCode.INVALID_INPUT, 'processType required');
    }
    if (!input.institutionId?.trim()) {
      throw new ProcessError(ProcessErrorCode.INVALID_INPUT, 'institutionId required');
    }
    if (this.processes.has(input.processId)) {
      throw new ProcessError(
        ProcessErrorCode.ALREADY_EXISTS,
        `process exists: ${input.processId}`,
      );
    }

    // Journal may already have process_open from a previous runtime
    const existingJournal = await this.nodechain.listByProcessId(input.processId);
    if (existingJournal.some((r) => r.recordType === 'process_open')) {
      throw new ProcessError(
        ProcessErrorCode.ALREADY_EXISTS,
        `process already on journal: ${input.processId}`,
      );
    }

    const body: ProcessTxBody = input.body
      ? { ...input.body }
      : {
          institutionId: input.institutionId,
          valuation: input.valuation,
          holderId: input.holderId,
        };
    if (!body.institutionId) {
      body.institutionId = input.institutionId;
    }

    let encoded;
    try {
      encoded = this.encoding.encode({
        processId: input.processId,
        processType: input.processType,
        body,
      });
    } catch (e) {
      if (e instanceof EncodingError) {
        throw new ProcessError(
          ProcessErrorCode.ENCODING_FAILED,
          `encoding failed: ${e.message}`,
          e.details,
        );
      }
      throw e;
    }

    const writerId = input.writerId ?? 'orchestrator';
    const openedAtUtc = new Date().toISOString();
    const valuation =
      input.valuation ?? body.valuation ?? body.newValue ?? body.amount;
    const holderId = input.holderId ?? body.holderId ?? body.toHolderId;

    await this.nodechain.append({
      clientRecordId: `process-open:${input.processId}`,
      recordType: 'process_open',
      processId: input.processId,
      payload: {
        processType: input.processType,
        institutionId: input.institutionId,
        valuation,
        holderId,
        body: encoded.body,
        payloadHash: encoded.payloadHash,
        encoded: encoded.encoded,
        schemaVersion: encoded.schemaVersion,
        institutionAllowlisted: input.institutionAllowlisted,
        hasDocuments: input.hasDocuments,
        hasQualifiedSignature: input.hasQualifiedSignature,
        openedAtUtc,
        initialStages: [...OPEN_COMPLETED_STAGES],
      },
      writerId,
      writerRole: 'orchestrator',
    });

    const state: ProcessState = {
      processId: input.processId,
      processType: input.processType,
      institutionId: input.institutionId,
      stage: 'awaiting_pot',
      stagesCompleted: [...OPEN_COMPLETED_STAGES],
      payloadHash: encoded.payloadHash,
      encoded: encoded.encoded,
      schemaVersion: encoded.schemaVersion,
      valuation,
      holderId,
      body: encoded.body,
      flags: {
        institutionAllowlisted: input.institutionAllowlisted,
        hasDocuments: input.hasDocuments,
        hasQualifiedSignature: input.hasQualifiedSignature,
      },
      openedAtUtc,
    };
    this.processes.set(input.processId, state);

    // Journal stage progression for audit (encoded + ready for PoT)
    await this.appendStage(input.processId, 'encoded', writerId, {
      payloadHash: encoded.payloadHash,
      schemaVersion: encoded.schemaVersion,
    });
    await this.appendStage(input.processId, 'awaiting_pot', writerId, {
      payloadHash: encoded.payloadHash,
    });

    this.recordTransition(input.processId, 'opened', 'awaiting_pot');
    return { ...state, stagesCompleted: [...state.stagesCompleted] };
  }

  /**
   * After PoT verified=1 (orchestrator responsibility — Processing does not run PoT).
   */
  async markPotDone(processId: string, meta?: { potLedgerHeight?: number }): Promise<ProcessState> {
    const p = this.require(processId);
    const from = p.stage;
    assertTransition(from, 'pot_done', processId);
    const at = new Date().toISOString();
    p.stage = 'pot_done';
    if (!p.stagesCompleted.includes('pot_done')) {
      p.stagesCompleted.push('pot_done');
    }
    p.potDoneAtUtc = at;
    await this.appendStage(processId, 'pot_done', 'orchestrator', {
      potLedgerHeight: meta?.potLedgerHeight,
      atUtc: at,
      from,
    });
    this.recordTransition(processId, from, 'pot_done');
    return this.clone(p);
  }

  /**
   * Lifecycle stage after economic path (mint/fee/reserve) completed by orchestrator.
   * Not commission settlement math — only process_stage(settled).
   */
  async markSettled(
    processId: string,
    meta?: { note?: string },
  ): Promise<ProcessState> {
    const p = this.require(processId);
    const from = p.stage;
    assertTransition(from, 'settled', processId);
    const at = new Date().toISOString();
    p.stage = 'settled';
    if (!p.stagesCompleted.includes('settled')) {
      p.stagesCompleted.push('settled');
    }
    p.settledAtUtc = at;
    await this.appendStage(processId, 'settled', 'orchestrator', {
      note: meta?.note,
      atUtc: at,
      from,
    });
    this.recordTransition(processId, from, 'settled');
    return this.clone(p);
  }

  /**
   * Close process. Allowed from pot_done (shortcut) or settled.
   */
  async close(processId: string): Promise<ProcessState> {
    const p = this.require(processId);
    const from = p.stage;
    assertTransition(from, 'closed', processId);
    const at = new Date().toISOString();
    p.stage = 'closed';
    if (!p.stagesCompleted.includes('closed')) {
      p.stagesCompleted.push('closed');
    }
    p.closedAtUtc = at;
    await this.nodechain.append({
      clientRecordId: `process-close:${processId}`,
      recordType: 'process_close',
      processId,
      payload: {
        stage: 'closed',
        from,
        atUtc: at,
        // Amendment 1: process end ≠ token death
        assetTokenExtinguished: false,
      },
      writerId: 'orchestrator',
      writerRole: 'orchestrator',
    });
    this.recordTransition(processId, from, 'closed');
    return this.clone(p);
  }

  /**
   * Abort process with reason. Writes process_abort. Terminal.
   */
  async abort(processId: string, reason: string): Promise<ProcessState> {
    if (!reason?.trim()) {
      throw new ProcessError(
        ProcessErrorCode.ABORT_REASON_REQUIRED,
        'abort reason required',
      );
    }
    const p = this.require(processId);
    const from = p.stage;
    assertTransition(from, 'aborted', processId);
    const at = new Date().toISOString();
    p.stage = 'aborted';
    if (!p.stagesCompleted.includes('aborted')) {
      p.stagesCompleted.push('aborted');
    }
    p.abortReason = reason.trim();
    p.abortedAtUtc = at;
    await this.nodechain.append({
      clientRecordId: `process-abort:${processId}`,
      recordType: 'process_abort',
      processId,
      payload: {
        stage: 'aborted',
        from,
        reason: p.abortReason,
        atUtc: at,
        payloadHash: p.payloadHash,
      },
      writerId: 'orchestrator',
      writerRole: 'orchestrator',
    });
    this.recordTransition(processId, from, 'aborted', p.abortReason);
    return this.clone(p);
  }

  /**
   * Rebuild in-memory state from journal (restart / cold get).
   * Walks records in height order; process_abort / process_close win as terminal.
   */
  async hydrate(processId: string): Promise<ProcessState> {
    const rows = (await this.nodechain.listByProcessId(processId)).sort(
      (a, b) => a.height - b.height,
    );
    const open = rows.find((r) => r.recordType === 'process_open');
    if (!open) {
      throw new ProcessError(
        ProcessErrorCode.HYDRATE_FAILED,
        `no process_open for ${processId}`,
      );
    }
    const payload = open.payload as Record<string, unknown>;
    const stagesCompleted: ProcessStage[] = [
      ...(Array.isArray(payload.initialStages)
        ? (payload.initialStages as ProcessStage[]).filter(isProcessStage)
        : (['opened', 'documents', 'encoded'] as ProcessStage[])),
    ];

    let stage: ProcessStage = stagesCompleted.includes('awaiting_pot')
      ? 'awaiting_pot'
      : 'opened';
    let abortReason: string | undefined;
    let potDoneAtUtc: string | undefined;
    let settledAtUtc: string | undefined;
    let closedAtUtc: string | undefined;
    let abortedAtUtc: string | undefined;

    for (const r of rows) {
      if (r.recordType === 'process_stage') {
        const raw = String((r.payload as { stage?: string }).stage ?? '');
        if (!isProcessStage(raw)) continue;
        const s = raw;
        if (!stagesCompleted.includes(s)) stagesCompleted.push(s);
        // Advance only if not already terminal from a later abort/close applied below
        if (!isTerminal(stage)) {
          if (s === 'pot_done' || s === 'settled' || s === 'awaiting_pot' || s === 'encoded') {
            stage = s === 'encoded' ? 'encoded' : s;
          }
        }
        if (s === 'pot_done') {
          potDoneAtUtc = String((r.payload as { atUtc?: string }).atUtc ?? r.timestampUtc);
        } else if (s === 'settled') {
          settledAtUtc = String((r.payload as { atUtc?: string }).atUtc ?? r.timestampUtc);
        }
      }
      if (r.recordType === 'process_close') {
        stage = 'closed';
        if (!stagesCompleted.includes('closed')) stagesCompleted.push('closed');
        closedAtUtc = String((r.payload as { atUtc?: string }).atUtc ?? r.timestampUtc);
      }
      if (r.recordType === 'process_abort') {
        stage = 'aborted';
        if (!stagesCompleted.includes('aborted')) stagesCompleted.push('aborted');
        abortReason = String((r.payload as { reason?: string }).reason ?? 'aborted');
        abortedAtUtc = String((r.payload as { atUtc?: string }).atUtc ?? r.timestampUtc);
      }
    }

    const state: ProcessState = {
      processId,
      processType: String(payload.processType ?? ''),
      institutionId: String(payload.institutionId ?? ''),
      stage,
      stagesCompleted,
      payloadHash: String(payload.payloadHash ?? ''),
      encoded: String(payload.encoded ?? ''),
      schemaVersion: String(payload.schemaVersion ?? ''),
      valuation: payload.valuation != null ? String(payload.valuation) : undefined,
      holderId: payload.holderId != null ? String(payload.holderId) : undefined,
      body: (payload.body as ProcessTxBody) ?? {
        institutionId: String(payload.institutionId ?? ''),
      },
      flags: {
        institutionAllowlisted: Boolean(payload.institutionAllowlisted),
        hasDocuments: Boolean(payload.hasDocuments),
        hasQualifiedSignature: Boolean(payload.hasQualifiedSignature),
      },
      openedAtUtc: String(payload.openedAtUtc ?? open.timestampUtc),
      abortReason,
      potDoneAtUtc,
      settledAtUtc,
      closedAtUtc,
      abortedAtUtc,
    };
    this.processes.set(processId, state);
    return this.clone(state);
  }

  /** get or hydrate from journal. */
  async getOrHydrate(processId: string): Promise<ProcessState> {
    const mem = this.processes.get(processId);
    if (mem) return this.clone(mem);
    return this.hydrate(processId);
  }

  /**
   * Scan journal for process_open rows and hydrate each into memory.
   */
  async hydrateAllFromJournal(): Promise<ProcessState[]> {
    const all = await this.nodechain.listAll();
    const ids = [
      ...new Set(
        all
          .filter((r) => r.recordType === 'process_open' && r.processId)
          .map((r) => r.processId as string),
      ),
    ];
    const out: ProcessState[] = [];
    for (const id of ids) {
      out.push(await this.hydrate(id));
    }
    return out;
  }

  assertNotTerminal(processId: string): ProcessState {
    const p = this.require(processId);
    if (isTerminal(p.stage)) {
      throw new ProcessError(
        ProcessErrorCode.TERMINAL,
        `process ${processId} is terminal (${p.stage})`,
      );
    }
    return this.clone(p);
  }

  private require(processId: string): ProcessState {
    const p = this.processes.get(processId);
    if (!p) {
      throw new ProcessError(ProcessErrorCode.NOT_FOUND, `unknown process ${processId}`);
    }
    return p;
  }

  private async appendStage(
    processId: string,
    stage: ProcessStage,
    writerId: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.nodechain.append({
      clientRecordId: `process-stage-${stage}:${processId}`,
      recordType: 'process_stage',
      processId,
      payload: { stage, ...extra },
      writerId,
      writerRole: 'orchestrator',
    });
  }

  private recordTransition(
    processId: string,
    from: ProcessStage,
    to: ProcessStage,
    reason?: string,
  ): void {
    this.transitions.push({
      processId,
      from,
      to,
      atUtc: new Date().toISOString(),
      reason,
    });
  }

  private clone(p: ProcessState): ProcessState {
    return {
      ...p,
      stagesCompleted: [...p.stagesCompleted],
      flags: { ...p.flags },
      body: { ...p.body },
    };
  }
}
