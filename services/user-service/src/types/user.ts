export interface User {
  id: string;
  displayName: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatedUser {
  email: string;
  displayName: string;
}
