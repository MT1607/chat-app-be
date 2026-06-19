import { publishUserCreatedEvent } from '@/messaging/event-pushlisher';
import { userRepository, UserRepository } from '@/repositories/user.repositories';
import { CreateUserInput, User } from '@/types/user';
import { AuthUserRegisteredPayload, HttpError } from '@chat-app-be/common';
import { UniqueConstraintError } from 'sequelize';

class UserService {
  constructor(private userRepository: UserRepository) {}

  async getUserById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new HttpError(404, 'User not found');
    }
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return this.userRepository.findAll();
  }

  async createUser(data: CreateUserInput): Promise<User> {
    try {
      const user = await this.userRepository.create(data);
      void publishUserCreatedEvent({
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
      });

      return user;
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new HttpError(400, 'User already exists');
      }
      throw error;
    }
  }

  async searchUsers(params: {
    query: string;
    excludeIds: string[];
    limit?: number;
  }): Promise<User[]> {
    const query = params.query.trim();
    if (!query) {
      return [];
    }
    return this.userRepository.searchByQuery(query, {
      excludeIds: params.excludeIds,
      limit: params.limit,
    });
  }

  async syncFromAuthUser(payload: AuthUserRegisteredPayload) {
    const user = await this.userRepository.upsertFromAuthEvent(payload);
    void publishUserCreatedEvent({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    });

    return user;
  }
}

export const userService = new UserService(userRepository);
