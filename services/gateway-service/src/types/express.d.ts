import { AuthenticatedUser } from '@chat-app-be/common/src';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
export {};
