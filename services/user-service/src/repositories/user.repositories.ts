import { UserModel } from '@/db';
import { User } from '@/types/user';
import type { AuthUserRegisteredPayload } from '@chat-app-be/common';

const toDomainUser = (user: UserModel): User => ({
  id: user.id,
  displayName: user.displayName,
  email: user.email,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export class UserRepository {
  async findById(id: string): Promise<User | null> {
    const user = await UserModel.findByPk(id);
    return user ? toDomainUser(user) : null;
  }

  async findAll(): Promise<User[]> {
    const users = await UserModel.findAll({ order: [['createdAt', 'ASC']] });
    return users.map(toDomainUser);
  }

  async upsertFromAuthEvent(payload: AuthUserRegisteredPayload): Promise<User> {
    const [user] = await UserModel.upsert(
      {
        id: payload.userId as string,
        displayName: payload.displayName,
        email: payload.email,
        createdAt: new Date(payload.createdAt),
        updatedAt: new Date(payload.createdAt),
      },
      { returning: true }
    );
    return toDomainUser(user);
  }
}
export const userRepository = new UserRepository();
