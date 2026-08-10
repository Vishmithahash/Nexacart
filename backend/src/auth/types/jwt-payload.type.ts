import { UserRole } from '../../generated/prisma/client';

export interface JwtPayload {
  /** User ID */
  sub: number;
  email: string;
  role: UserRole;
  sessionId: string;
}
