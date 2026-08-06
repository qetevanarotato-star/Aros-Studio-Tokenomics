import {
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Query,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { ProcessesService } from '../processes/processes.service';

/**
 * Phase D — operator control plane aggregate (read-only economics).
 * No mint / veto / journal rewrite.
 */
@Controller('v1/ops')
export class OpsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ProcessesService) private readonly processes: ProcessesService,
  ) {}

  private requireOperator(sessionId: string | undefined) {
    const s = this.auth.resolve(sessionId);
    if (!s) {
      throw new HttpException(
        { code: 'AUTH_SESSION', message: 'login required' },
        401,
      );
    }
    if ((s.role ?? 'institution') !== 'operator') {
      throw new HttpException(
        { code: 'FORBIDDEN', message: 'operator role required' },
        403,
      );
    }
    return s;
  }

  @Get('overview')
  async overview(
    @Headers('x-session-id') sessionId: string | undefined,
    @Query('limit') limitRaw?: string,
  ) {
    this.requireOperator(sessionId);
    const limit = limitRaw ? Number(limitRaw) : 50;
    const cap = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50;

    let health: Record<string, unknown> = {};
    let ready: Record<string, unknown> = {};
    let nodechain: Record<string, unknown> = {};

    // Same-process HTTP to public surfaces (live values only)
    try {
      const port = process.env.PORTAL_PORT ?? '3100';
      const origin = `http://127.0.0.1:${port}`;
      const [hRes, rRes, nRes] = await Promise.all([
        fetch(`${origin}/v1/health`).catch(() => null),
        fetch(`${origin}/v1/health/ready`).catch(() => null),
        fetch(`${origin}/v1/public/nodechain/status`).catch(() => null),
      ]);
      if (hRes?.ok) health = (await hRes.json()) as Record<string, unknown>;
      if (rRes?.ok) ready = (await rRes.json()) as Record<string, unknown>;
      if (nRes?.ok) nodechain = (await nRes.json()) as Record<string, unknown>;
    } catch {
      /* keep partial */
    }

    const all = this.processes.listAllEdge();
    const items = all.slice(0, cap);
    return {
      generatedAt: new Date().toISOString(),
      health,
      ready,
      nodechain,
      processes: {
        count: items.length,
        totalOnEdge: all.length,
        items: items.map((r) => ({
          processId: r.processId,
          status: r.status,
          institutionId: r.institutionId,
          holderId: r.holderId,
          counterpartyIds: r.counterpartyIds ?? [],
          valuation: r.valuation,
          fiatEvidenceCount: (r.fiatEvidence ?? []).length,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      },
      note: 'Edge aggregate + NodeChain public status. Portal never mints. No veto.',
      mintOnPortal: false,
    };
  }
}
