import { sequelize } from '@/db/sequelize';

import { UserCredentials } from '@/models/user-credential.model';
import { RefreshToken } from '@/models/refresh-token.model';

export const initModels = async () => {
  await sequelize.sync({ alter: true });
};

export { UserCredentials, RefreshToken };
