import { MemoryJournalStore } from '../nodechain/memory.store';
import { NodechainService } from '../nodechain/nodechain.service';
import { bootstrapPipelineKeys } from '../common/crypto/bootstrap-keys';
import { TokenService } from './token.service';
import { TokenError, TokenErrorCode } from './errors';

async function journalOkToEmit(nc: NodechainService, processId: string): Promise<number> {
  await nc.append({
    clientRecordId: `pot-evidence:${processId}`,
    recordType: 'pot_evidence',
    processId,
    payload: {
      processId,
      stagesCompleted: ['opened', 'documents', 'encoded'],
    },
    writerId: 'pot',
    writerRole: 'pot',
  });
  const v = await nc.append({
    clientRecordId: `pot-verdict:${processId}`,
    recordType: 'pot_verdict',
    processId,
    payload: {
      verified: 1,
      final: true,
      criteriaResult: { P1: true, P2: true, P3: true, P4: true },
      okToEmit: true,
    },
    writerId: 'pot',
    writerRole: 'pot',
  });
  return v.height;
}

describe('TokenService (layer 05 deep)', () => {
  async function setup() {
    const keys = bootstrapPipelineKeys();
    const nc = new NodechainService(new MemoryJournalStore(), { keys });
    await nc.ensureGenesis('system');
    return { nc, token: new TokenService(nc), keys };
  }

  it('mints only after journal ok-to-emit (P1–P4 + verified=1)', async () => {
    const { token, nc } = await setup();
    await expect(
      token.mintAfterPot({
        processId: 'AST-DEMO-20260719-mintfail1',
        holderId: 'h1',
        amount: '10.000000000',
        potVerified: 1,
        potLedgerHeight: 1,
      }),
    ).rejects.toMatchObject({ code: TokenErrorCode.MINT_WITHOUT_POT });

    // verified=0 call also fails closed
    await expect(
      token.mintAfterPot({
        processId: 'AST-DEMO-20260719-mintfail2',
        holderId: 'h1',
        amount: '10.000000000',
        potVerified: 0,
        potLedgerHeight: 1,
      }),
    ).rejects.toMatchObject({ code: TokenErrorCode.MINT_WITHOUT_POT });

    const processId = 'AST-DEMO-20260719-mintok1';
    const h = await journalOkToEmit(nc, processId);
    const m = await token.mintAfterPot({
      processId,
      holderId: 'h1',
      amount: '10.000000000',
      potVerified: 1,
      potLedgerHeight: h,
    });
    expect(m.amount).toBe('10.000000000');
    expect(token.balanceOf('h1')).toBe('10.000000000');
  });

  it('prevents double mint per process via journal', async () => {
    const { token, nc } = await setup();
    const processId = 'AST-DEMO-20260719-dblmint';
    const h = await journalOkToEmit(nc, processId);
    await token.mintAfterPot({
      processId,
      holderId: 'h1',
      amount: '10.000000000',
      potVerified: 1,
      potLedgerHeight: h,
    });
    await expect(
      token.mintAfterPot({
        processId,
        holderId: 'h1',
        amount: '10.000000000',
        potVerified: 1,
        potLedgerHeight: h,
      }),
    ).rejects.toMatchObject({ code: TokenErrorCode.DOUBLE_MINT });
    expect(token.balanceOf('h1')).toBe('10.000000000');
    expect(token.totalSupply()).toBe('10.000000000');
  });

  it('transfers only after pot', async () => {
    const { token, nc } = await setup();
    const mintId = 'AST-DEMO-20260719-mintt';
    const h = await journalOkToEmit(nc, mintId);
    await token.mintAfterPot({
      processId: mintId,
      holderId: 'a',
      amount: '20.000000000',
      potVerified: 1,
      potLedgerHeight: h,
    });
    await expect(
      token.transferAfterPot({
        processId: 'AST-DEMO-20260719-xfer1',
        fromHolderId: 'a',
        toHolderId: 'b',
        amount: '5.000000000',
        potVerified: 0,
        potLedgerHeight: 2,
      }),
    ).rejects.toBeInstanceOf(TokenError);

    const t = await token.transferAfterPot({
      processId: 'AST-DEMO-20260719-xfer2',
      fromHolderId: 'a',
      toHolderId: 'b',
      amount: '5.000000000',
      potVerified: 1,
      potLedgerHeight: 2,
    });
    expect(token.balanceOf('a')).toBe('15.000000000');
    expect(token.balanceOf('b')).toBe('5.000000000');
    expect(t.amount).toBe('5.000000000');
  });

  it('revalues pro-rata on value increase', async () => {
    const { token, nc } = await setup();
    const m1 = 'AST-DEMO-20260719-m1';
    const m2 = 'AST-DEMO-20260719-m2';
    const h1 = await journalOkToEmit(nc, m1);
    await token.mintAfterPot({
      processId: m1,
      holderId: 'a',
      amount: '40.000000000',
      potVerified: 1,
      potLedgerHeight: h1,
    });
    const h2 = await journalOkToEmit(nc, m2);
    await token.mintAfterPot({
      processId: m2,
      holderId: 'b',
      amount: '60.000000000',
      potVerified: 1,
      potLedgerHeight: h2,
    });
    const r = await token.revalueAfterPot({
      processId: 'AST-DEMO-20260719-reval1',
      previousValue: '100.000000000',
      newValue: '200.000000000',
      potVerified: 1,
      potLedgerHeight: 3,
    });
    expect(r.supplyAfter).toBe('200.000000000');
    expect(token.balanceOf('a')).toBe('80.000000000');
    expect(token.balanceOf('b')).toBe('120.000000000');
  });

  it('hydrates balances from journal', async () => {
    const { nc, token } = await setup();
    const processId = 'AST-DEMO-20260719-mh';
    const h = await journalOkToEmit(nc, processId);
    await token.mintAfterPot({
      processId,
      holderId: 'h',
      amount: '7.000000000',
      potVerified: 1,
      potLedgerHeight: h,
    });
    const token2 = new TokenService(nc);
    await token2.hydrateFromJournal();
    expect(token2.balanceOf('h')).toBe('7.000000000');
    expect(token2.totalSupply()).toBe('7.000000000');
  });

  it('refuses burn whose reason is process close / extinguish', async () => {
    const { token, nc } = await setup();
    const processId = 'AST-DEMO-20260831-noburn';
    const h = await journalOkToEmit(nc, processId);
    await token.mintAfterPot({
      processId,
      holderId: 'h',
      amount: '10.000000000',
      potVerified: 1,
      potLedgerHeight: h,
    });
    await expect(
      token.burn({
        processId,
        holderId: 'h',
        amount: '10.000000000',
        reason: 'process_close',
      }),
    ).rejects.toMatchObject({ code: TokenErrorCode.PROCESS_CLOSE_EXTINGUISH });
    expect(token.balanceOf('h')).toBe('10.000000000');
  });

  it('close of process leaves minted balance after hydrate', async () => {
    const { token, nc } = await setup();
    const processId = 'AST-DEMO-20260831-keep';
    const h = await journalOkToEmit(nc, processId);
    await token.mintAfterPot({
      processId,
      holderId: 'h',
      amount: '4.000000000',
      potVerified: 1,
      potLedgerHeight: h,
    });
    await nc.append({
      clientRecordId: `process-close:${processId}`,
      recordType: 'process_close',
      processId,
      payload: { stage: 'closed', assetTokenExtinguished: false },
      writerId: 'orchestrator',
      writerRole: 'orchestrator',
    });
    const token2 = new TokenService(nc);
    await token2.hydrateFromJournal();
    expect(token2.balanceOf('h')).toBe('4.000000000');
  });

  it('burns and journals burn_fact', async () => {
    const { token, nc } = await setup();
    const processId = 'AST-DEMO-20260719-mb';
    const h = await journalOkToEmit(nc, processId);
    await token.mintAfterPot({
      processId,
      holderId: 'h',
      amount: '10.000000000',
      potVerified: 1,
      potLedgerHeight: h,
    });
    await token.burn({
      processId: 'AST-DEMO-20260719-burnp',
      holderId: 'h',
      amount: '3.000000000',
    });
    expect(token.balanceOf('h')).toBe('7.000000000');
    const rows = await nc.listByProcessId('AST-DEMO-20260719-burnp');
    expect(rows.some((r) => r.recordType === 'burn_fact')).toBe(true);
  });
});
