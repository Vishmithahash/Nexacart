import { UserRole } from '../../generated/prisma/client';

export interface AuthenticatedUser {
  id: number;
  email: string;
  role: UserRole;
  sessionId: string;
}
