import {
  Body,
  Controller,
  Headers,
  HttpException,
  Inject,
  Post,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { ProcessesService } from '../processes/processes.service';

/**
 * Phase F local — bank/PSP sandbox webhook (evidence only, never mint).
 */
@Controller('v1/sandbox')
export class SandboxController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ProcessesService) private readonly processes: ProcessesService,
  ) {}

  @Post('bank/webhook')
  bankWebhook(
    @Body()
    body: {
      processId?: string;
      reference?: string;
      status?: string;
      amount?: string;
      currency?: string;
      provider?: string;
    },
    @Headers('x-sandbox-secret') sandboxSecret: string | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
  ) {
    const expected =
      process.env.AST_BANK_SANDBOX_SECRET?.trim() || 'sandbox-dev-secret';
    const secretOk =
      Boolean(sandboxSecret) &&
      sandboxSecret === expected;

    const session = this.auth.resolve(sessionId);
    const operatorOk = session?.role === 'operator';

    if (!secretOk && !operatorOk) {
      throw new HttpException(
        {
          code: 'SANDBOX_AUTH',
          message:
            'provide X-Sandbox-Secret (AST_BANK_SANDBOX_SECRET) or operator session',
        },
        401,
      );
    }

    const processId = body.processId?.trim();
    if (!processId) {
      throw new HttpException(
        { code: 'VALIDATION_ERROR', message: 'processId required' },
        400,
      );
    }

    const result = this.processes.attachFiatEvidence(processId, {
      provider: body.provider ?? 'sandbox-bank',
      reference: body.reference ?? '',
      status: body.status ?? 'settled',
      amount: body.amount,
      currency: body.currency,
    });
    if (result.statusCode >= 400) {
      throw new HttpException(result.body, result.statusCode);
    }
    return result.body;
  }
}
