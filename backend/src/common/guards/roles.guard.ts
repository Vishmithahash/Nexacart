import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../generated/prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ApiException } from '../exceptions/api.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator → no role restriction on this route
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    const user = request.user;

    // If no user at this point, JWT guard should have already rejected the request.
    // This is a safety check.
    if (!user) {
      throw ApiException.forbidden();
    }

    // Role MUST come from the authenticated JWT payload — never from headers/body
    if (!requiredRoles.includes(user.role)) {
      throw ApiException.forbidden();
    }

    return true;
  }
}
