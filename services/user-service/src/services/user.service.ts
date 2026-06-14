import { userRepository, UserRepository } from '@/repositories/user.repositories';
import { AuthUserRegisteredPayload } from '@chat-app-be/common';

class UserService {
  constructor(private userRepository: UserRepository) {}

  async syncFromAuthUser(payload: AuthUserRegisteredPayload) {
    const user = await this.userRepository.upsertFromAuthEvent(payload);
    return user;
  }
}

export const userService = new UserService(userRepository);
