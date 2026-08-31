import { MemoryJournalStore } from '../nodechain/memory.store';
import { NodechainService } from '../nodechain/nodechain.service';
import { bootstrapPipelineKeys } from '../common/crypto/bootstrap-keys';
import { ProcessService } from './process.service';
import { ProcessError, ProcessErrorCode } from './errors';
import { canTransition, isTerminal } from './stages';

const PID = 'AST-DEMO-20260719-proc1';

async function setup() {
  const keys = bootstrapPipelineKeys();
  const nc = new NodechainService(new MemoryJournalStore(), { keys });
  await nc.ensureGenesis('system');
  const proc = new ProcessService(nc);
  return { nc, proc, keys };
}

async function openPrimary(proc: ProcessService, processId = PID) {
  return proc.open({
    processId,
    processType: 'primary_tokenization',
    institutionId: 'DEMO',
    valuation: '1.000000000',
    holderId: 'h',
    institutionAllowlisted: true,
    hasDocuments: true,
    hasQualifiedSignature: true,
  });
}

describe('ProcessService (layer 03 deep)', () => {
  it('opens process and writes process_open + stage records', async () => {
    const { nc, proc } = await setup();
    const p = await openPrimary(proc);
    expect(p.stage).toBe('awaiting_pot');
    expect(p.payloadHash).toBeTruthy();
    expect(p.stagesCompleted).toEqual(
      expect.arrayContaining(['opened', 'documents', 'encoded', 'awaiting_pot']),
    );
    expect(p.flags.hasDocuments).toBe(true);
    expect(p.openedAtUtc).toBeTruthy();

    const rows = await nc.listByProcessId(PID);
    expect(rows.map((r) => r.recordType)).toEqual(
      expect.arrayContaining(['process_open', 'process_stage']),
    );
    const stages = rows
      .filter((r) => r.recordType === 'process_stage')
      .map((r) => (r.payload as { stage: string }).stage);
    expect(stages).toEqual(expect.arrayContaining(['encoded', 'awaiting_pot']));
  });

  it('happy path: pot_done → settled → closed', async () => {
    const { nc, proc } = await setup();
    await openPrimary(proc);
    await proc.markPotDone(PID, { potLedgerHeight: 5 });
    expect(proc.get(PID)!.stage).toBe('pot_done');

    await proc.markSettled(PID, { note: 'mint+fee done' });
    expect(proc.get(PID)!.stage).toBe('settled');
    expect(proc.get(PID)!.settledAtUtc).toBeTruthy();

    await proc.close(PID);
    expect(proc.get(PID)!.stage).toBe('closed');
    expect(isTerminal(proc.get(PID)!.stage)).toBe(true);

    const rows = await nc.listByProcessId(PID);
    expect(rows.map((r) => r.recordType)).toEqual(
      expect.arrayContaining(['process_close']),
    );
  });

  it('process close does not write burn_fact (asset token permanent)', async () => {
    const { nc, proc } = await setup();
    const pid = 'AST-DEMO-20260831-perm1';
    await openPrimary(proc, pid);
    await proc.markPotDone(pid, { potLedgerHeight: 3 });
    await proc.markSettled(pid, { note: 'mint done' });
    await proc.close(pid);
    const rows = await nc.listByProcessId(pid);
    expect(rows.some((r) => r.recordType === 'burn_fact')).toBe(false);
    const close = rows.find((r) => r.recordType === 'process_close');
    expect(close?.payload).toEqual(
      expect.objectContaining({ assetTokenExtinguished: false }),
    );
  });

  it('allows close shortcut from pot_done (no settle)', async () => {
    const { proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-proc2');
    await proc.markPotDone('AST-DEMO-20260719-proc2');
    await proc.close('AST-DEMO-20260719-proc2');
    expect(proc.get('AST-DEMO-20260719-proc2')!.stage).toBe('closed');
  });

  it('aborts from awaiting_pot with process_abort journal', async () => {
    const { nc, proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-abort1');
    const aborted = await proc.abort('AST-DEMO-20260719-abort1', 'PoT rejected');
    expect(aborted.stage).toBe('aborted');
    expect(aborted.abortReason).toBe('PoT rejected');

    const rows = await nc.listByProcessId('AST-DEMO-20260719-abort1');
    expect(rows.some((r) => r.recordType === 'process_abort')).toBe(true);
  });

  it('rejects double open', async () => {
    const { proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-dup');
    await expect(openPrimary(proc, 'AST-DEMO-20260719-dup')).rejects.toMatchObject({
      code: ProcessErrorCode.ALREADY_EXISTS,
    });
  });

  it('rejects invalid transitions', async () => {
    const { proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-badtr');
    await expect(proc.markSettled('AST-DEMO-20260719-badtr')).rejects.toBeInstanceOf(
      ProcessError,
    );
    await expect(proc.close('AST-DEMO-20260719-badtr')).rejects.toMatchObject({
      code: ProcessErrorCode.INVALID_TRANSITION,
    });
  });

  it('rejects operations on terminal process', async () => {
    const { proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-term');
    await proc.abort('AST-DEMO-20260719-term', 'stop');
    await expect(proc.markPotDone('AST-DEMO-20260719-term')).rejects.toMatchObject({
      code: ProcessErrorCode.TERMINAL,
    });
    await expect(proc.close('AST-DEMO-20260719-term')).rejects.toMatchObject({
      code: ProcessErrorCode.TERMINAL,
    });
  });

  it('rejects abort without reason', async () => {
    const { proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-noreason');
    await expect(proc.abort('AST-DEMO-20260719-noreason', '  ')).rejects.toMatchObject({
      code: ProcessErrorCode.ABORT_REASON_REQUIRED,
    });
  });

  it('hydrates state from journal after memory loss', async () => {
    const { nc, proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-hyd');
    await proc.markPotDone('AST-DEMO-20260719-hyd');
    await proc.markSettled('AST-DEMO-20260719-hyd');
    await proc.close('AST-DEMO-20260719-hyd');

    // Simulate restart: new service, same journal
    const proc2 = new ProcessService(nc);
    const h = await proc2.hydrate('AST-DEMO-20260719-hyd');
    expect(h.stage).toBe('closed');
    expect(h.payloadHash).toBeTruthy();
    expect(h.stagesCompleted).toEqual(
      expect.arrayContaining(['opened', 'encoded', 'awaiting_pot', 'pot_done', 'settled', 'closed']),
    );
    expect(h.flags.institutionAllowlisted).toBe(true);
  });

  it('hydrates aborted process', async () => {
    const { nc, proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-hydab');
    await proc.abort('AST-DEMO-20260719-hydab', 'timeout');

    const proc2 = new ProcessService(nc);
    const h = await proc2.getOrHydrate('AST-DEMO-20260719-hydab');
    expect(h.stage).toBe('aborted');
    expect(h.abortReason).toBe('timeout');
  });

  it('wraps encoding failures as ProcessError', async () => {
    const { proc } = await setup();
    await expect(
      proc.open({
        processId: 'BAD-ID',
        processType: 'primary_tokenization',
        institutionId: 'DEMO',
        valuation: '1.0',
        holderId: 'h',
        institutionAllowlisted: true,
        hasDocuments: true,
        hasQualifiedSignature: true,
      }),
    ).rejects.toMatchObject({ code: ProcessErrorCode.ENCODING_FAILED });
  });

  it('lists by stage', async () => {
    const { proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-list1');
    await openPrimary(proc, 'AST-DEMO-20260719-list2');
    await proc.markPotDone('AST-DEMO-20260719-list2');
    expect(proc.listByStage('awaiting_pot')).toHaveLength(1);
    expect(proc.listByStage('pot_done')).toHaveLength(1);
  });

  it('FSM helper: canTransition', () => {
    expect(canTransition('awaiting_pot', 'pot_done')).toBe(true);
    expect(canTransition('awaiting_pot', 'closed')).toBe(false);
    expect(canTransition('closed', 'aborted')).toBe(false);
  });

  it('records stage transition events', async () => {
    const { proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-ev');
    await proc.markPotDone('AST-DEMO-20260719-ev');
    const events = proc.recentTransitions();
    expect(events.some((e) => e.to === 'pot_done')).toBe(true);
  });

  it('aborts from pot_done (PoT pass but later fail path)', async () => {
    const { nc, proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-abortpot');
    await proc.markPotDone('AST-DEMO-20260719-abortpot');
    const a = await proc.abort('AST-DEMO-20260719-abortpot', 'L3 failed');
    expect(a.stage).toBe('aborted');
    expect(a.abortReason).toBe('L3 failed');
    const rows = await nc.listByProcessId('AST-DEMO-20260719-abortpot');
    expect(rows.some((r) => r.recordType === 'process_abort')).toBe(true);
  });

  it('hydrateAllFromJournal rebuilds multiple processes', async () => {
    const { nc, proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-ha1');
    await openPrimary(proc, 'AST-DEMO-20260719-ha2');
    await proc.markPotDone('AST-DEMO-20260719-ha2');
    const proc2 = new ProcessService(nc);
    const all = await proc2.hydrateAllFromJournal();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(proc2.get('AST-DEMO-20260719-ha2')?.stage).toBe('pot_done');
  });

  it('does not expose mutable internal stage arrays via get()', async () => {
    const { proc } = await setup();
    await openPrimary(proc, 'AST-DEMO-20260719-immut');
    const snap = proc.get('AST-DEMO-20260719-immut')!;
    snap.stagesCompleted.push('closed' as never);
    expect(proc.get('AST-DEMO-20260719-immut')!.stagesCompleted).not.toContain('closed');
  });
});
