import type { AuthenticatedUser } from '@chat-app-be/common';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
