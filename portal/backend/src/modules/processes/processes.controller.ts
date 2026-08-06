import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { AttachDocumentsBody, CreateProcessBody } from '../../common/shared-bridge';
import { ProcessesService } from './processes.service';
import { AuthService } from '../auth/auth.service';

@Controller('v1/processes')
export class ProcessesController {
  constructor(
    @Inject(ProcessesService) private readonly processes: ProcessesService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private requireSession(sessionId: string | undefined) {
    const s = this.auth.resolve(sessionId);
    if (!s) {
      throw new HttpException(
        { code: 'AUTH_SESSION', message: 'login required — POST /v1/auth/login' },
        401,
      );
    }
    return s;
  }

  @Get('stats')
  stats(@Headers('x-session-id') sessionId: string | undefined) {
    const s = this.requireSession(sessionId);
    return this.processes.statsForInstitution(s.institutionId, s.role ?? 'institution');
  }

  @Get()
  list(
    @Headers('x-session-id') sessionId: string | undefined,
    @Query('status') status?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const s = this.requireSession(sessionId);
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const items = this.processes.listForActor(s.institutionId, s.role ?? 'institution', {
      status,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return {
      institutionId: s.institutionId,
      role: s.role ?? 'institution',
      count: items.length,
      processes: items.map((r) => ({
        processId: r.processId,
        status: r.status,
        processType: r.processType,
        valuation: r.valuation,
        holderId: r.holderId,
        institutionId: r.institutionId,
        counterpartyIds: r.counterpartyIds ?? [],
        documentPackageHash: r.documentPackageHash,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  @Post()
  async create(
    @Body() body: CreateProcessBody,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
    @Headers('x-institution-id') institutionIdHeader: string | undefined,
  ) {
    const s = this.requireSession(sessionId);
    const role = s.role ?? 'institution';
    if (role === 'counterparty' || role === 'holder') {
      throw new HttpException(
        {
          code: 'FORBIDDEN',
          message: 'counterparty/holder cannot create processes — issuer institution only',
        },
        403,
      );
    }
    if (
      institutionIdHeader &&
      institutionIdHeader.toUpperCase() !== s.institutionId
    ) {
      throw new HttpException(
        { code: 'FORBIDDEN', message: 'institution header mismatch session' },
        403,
      );
    }
    const result = await this.processes.create(
      body,
      s.institutionId,
      idempotencyKey,
      s.token,
    );
    if (result.statusCode >= 400) {
      throw new HttpException(result.body, result.statusCode);
    }
    return result.body;
  }

  @Get(':processId')
  async get(
    @Param('processId') processId: string,
    @Headers('x-session-id') sessionId: string | undefined,
  ) {
    const s = this.requireSession(sessionId);
    const result = await this.processes.getWithRole(
      processId,
      s.institutionId,
      s.role ?? 'institution',
      s.token,
    );
    if (result.statusCode >= 400) {
      throw new HttpException(result.body, result.statusCode);
    }
    return result.body;
  }

  /**
   * Digitization certificate — owner, counterparty, holder, operator (read).
   */
  @Get(':processId/certificate')
  async certificate(
    @Param('processId') processId: string,
    @Headers('x-session-id') sessionId: string | undefined,
  ) {
    const s = this.requireSession(sessionId);
    const result = await this.processes.getCertificate(
      processId,
      s.institutionId,
      s.token,
      s.role ?? 'institution',
    );
    if (result.statusCode >= 400) {
      throw new HttpException(result.body, result.statusCode);
    }
    return result.body;
  }

  /**
   * Two-sided: invite allowlisted counterparty institution onto process.
   */
  @Post(':processId/invite-counterparty')
  inviteCounterparty(
    @Param('processId') processId: string,
    @Body() body: { counterpartyInstitutionId?: string },
    @Headers('x-session-id') sessionId: string | undefined,
  ) {
    const s = this.requireSession(sessionId);
    const result = this.processes.inviteCounterparty(
      processId,
      s.institutionId,
      s.role ?? 'institution',
      body.counterpartyInstitutionId ?? '',
      (id) => this.auth.isAllowlistedInstitution(id),
    );
    if (result.statusCode >= 400) {
      throw new HttpException(result.body, result.statusCode);
    }
    return result.body;
  }

  /**
   * Bind EVM wallet (0x…) — owner, holder, or operator.
   */
  @Post(':processId/bind-wallet')
  bindWallet(
    @Param('processId') processId: string,
    @Body() body: { holderWallet?: string },
    @Headers('x-session-id') sessionId: string | undefined,
  ) {
    const s = this.requireSession(sessionId);
    const result = this.processes.bindHolderWallet(
      processId,
      s.institutionId,
      body.holderWallet ?? '',
      s.role ?? 'institution',
    );
    if (result.statusCode >= 400) {
      throw new HttpException(result.body, result.statusCode);
    }
    return result.body;
  }

  @Post(':processId/documents')
  async attachDocuments(
    @Param('processId') processId: string,
    @Body() body: AttachDocumentsBody,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
  ) {
    const s = this.requireSession(sessionId);
    const role = s.role ?? 'institution';
    if (role === 'counterparty' || role === 'holder') {
      throw new HttpException(
        { code: 'FORBIDDEN', message: 'only process owner may attach documents' },
        403,
      );
    }
    const result = await this.processes.attachDocuments(
      processId,
      body,
      s.institutionId,
      idempotencyKey,
    );
    if (result.statusCode >= 400) {
      throw new HttpException(result.body, result.statusCode);
    }
    return result.body;
  }

  /** Retry Core hand-off when edge is stuck awaiting_core. */
  @Post(':processId/retry-handoff')
  async retryHandoff(
    @Param('processId') processId: string,
    @Headers('x-session-id') sessionId: string | undefined,
  ) {
    const s = this.requireSession(sessionId);
    const role = s.role ?? 'institution';
    if (role === 'counterparty' || role === 'holder') {
      throw new HttpException(
        { code: 'FORBIDDEN', message: 'only process owner may retry hand-off' },
        403,
      );
    }
    const result = await this.processes.retryHandoff(
      processId,
      s.institutionId,
      s.token,
    );
    if (result.statusCode >= 400) {
      throw new HttpException(result.body, result.statusCode);
    }
    return result.body;
  }
}
