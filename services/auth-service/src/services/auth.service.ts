import { sequelize } from '@/db/sequelize';
import { UserCredentials, RefreshToken } from '@/models';
import { AuthResponse, RegisterInput } from '@/types/auth';
import { hashPassword, signAccessToken, signRefreshToken } from '@/utils/token';
import { HttpError } from '@chat-app-be/common';
import { create } from 'node:domain';
import { Op, Transaction } from 'sequelize';

const REFRESH_TOKEN_TTL_DAYS = 30;

export const register = async (input: RegisterInput): Promise<AuthResponse> => {
  const existing = await UserCredentials.findOne({ where: { email: { [Op.eq]: input.email } } });

  if (existing) {
    throw new HttpError(409, 'User with this email already exists');
  }

  const transaction = await sequelize.transaction();
  try {
    const passwordHash = await hashPassword(input.password);
    const user = await UserCredentials.create(
      {
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      },
      { transaction }
    );
    const refreshTokenReport = await createRefreshToken(user.id, transaction);
    await transaction.commit();

    const accessToken = signAccessToken({ sub: user.id, email: user.email });
    const refreshToken = signRefreshToken({ sub: user.id, tokenId: refreshTokenReport.tokenId });

    const userData = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    };

    //Todo: publish user registered event

    return {
      user: userData,
      accessToken,
      refreshToken,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
  return {} as AuthResponse;
};

const createRefreshToken = async (userId: string, transaction?: Transaction) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS); // Set expiration to 30 days

  const tokenId = crypto.randomUUID();

  const record = await RefreshToken.create(
    {
      userCredentialId: userId,
      tokenId,
      expiresAt,
    },
    { transaction }
  );

  return record;
};
