import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/exceptions/api.exception';
import type { JwtPayload } from '../types/jwt-payload.type';
import type { AuthenticatedUser } from '../types/authenticated-user.type';
import { UserStatus } from '../../generated/prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub || !payload.sessionId) {
      throw ApiException.tokenInvalid();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!user) {
      throw ApiException.tokenInvalid();
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw ApiException.accountInactive();
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });

    if (!session || session.userId !== user.id) {
      throw ApiException.sessionInvalid();
    }

    if (session.revokedAt) {
      throw ApiException.sessionRevoked();
    }

    if (session.expiresAt < new Date()) {
      throw ApiException.sessionExpired();
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id,
    };
  }
}
