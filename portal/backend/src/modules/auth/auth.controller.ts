import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('v1/auth')
export class AuthController {
  // Explicit @Inject: tsx does not emit design:paramtypes for Nest DI
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('institutions')
  institutions() {
    return { institutions: this.auth.listInstitutionsPublic() };
  }

  @Post('login')
  login(@Body() body: { institutionId?: string; token?: string }) {
    const r = this.auth.login(body.institutionId, body.token);
    if (!r.ok) {
      throw new HttpException({ code: r.code, message: r.message }, 401);
    }
    return {
      sessionId: r.session.sessionId,
      institutionId: r.session.institutionId,
      displayName: r.session.displayName,
      expiresAt: r.session.expiresAt,
      role: r.session.role,
      mode: 'password',
    };
  }

  /** D6 — client cert identity from trusted reverse proxy headers. */
  @Post('login/mtls')
  loginMtls(@Headers() headers: Record<string, string | string[] | undefined>) {
    const r = this.auth.loginMtls(headers);
    if (!r.ok) {
      throw new HttpException({ code: r.code, message: r.message }, 401);
    }
    return {
      sessionId: r.session.sessionId,
      institutionId: r.session.institutionId,
      displayName: r.session.displayName,
      expiresAt: r.session.expiresAt,
      role: r.session.role,
      mode: 'mtls',
      subject: r.subject,
    };
  }

  /** D6 — OIDC pilot (HS256 bearer). Production: JWKS residual. */
  @Post('login/oidc')
  loginOidc(@Headers('authorization') authorization: string | undefined) {
    const r = this.auth.loginOidc(authorization);
    if (!r.ok) {
      throw new HttpException({ code: r.code, message: r.message }, 401);
    }
    return {
      sessionId: r.session.sessionId,
      institutionId: r.session.institutionId,
      displayName: r.session.displayName,
      expiresAt: r.session.expiresAt,
      role: r.session.role,
      mode: 'oidc',
    };
  }

  @Get('me')
  me(@Headers('x-session-id') sessionId: string | undefined) {
    const s = this.auth.resolve(sessionId);
    if (!s) {
      throw new HttpException(
        { code: 'AUTH_SESSION', message: 'not authenticated' },
        401,
      );
    }
    const role = s.role ?? 'institution';
    return {
      institutionId: s.institutionId,
      displayName: s.displayName,
      expiresAt: s.expiresAt,
      sessionId: s.sessionId,
      role,
      product: 'Aros Studio Tokenomics (AST) Institutional Portal',
      capabilities: {
        primaryTokenization: role === 'institution' || role === 'operator',
        documentHash: role === 'institution' || role === 'operator',
        coreHandOff: role === 'institution' || role === 'operator',
        inviteCounterparty: role === 'institution' || role === 'operator',
        opsConsole: role === 'operator',
        holderView: role === 'holder',
        counterpartyView: role === 'counterparty',
        mintOnEdge: false,
      },
    };
  }

  @Post('logout')
  logout(@Headers('x-session-id') sessionId: string | undefined) {
    this.auth.logout(sessionId);
    return { ok: true };
  }
}
