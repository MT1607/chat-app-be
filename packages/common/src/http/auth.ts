export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export const USER_ID_HEADER = 'x-user-id';
