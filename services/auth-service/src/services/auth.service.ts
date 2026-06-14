import { sequelize } from '@/db/sequelize';
import { publishAuthUserRegistered } from '@/messaging/event-publishing';
import { UserCredentials, RefreshToken } from '@/models';
import { AuthResponse, AuthTokens, LoginInput, RegisterInput } from '@/types/auth';
import { logger } from '@/utils/logger';
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from '@/utils/token';
import { HttpError } from '@chat-app-be/common';
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

    publishAuthUserRegistered(userData);

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

export const login = async (input: LoginInput): Promise<AuthTokens> => {
  // TODO: Check user credentials
  const user = await UserCredentials.findOne({ where: { email: { [Op.eq]: input.email } } });

  if (!user) {
    throw new HttpError(401, 'Invalid email or password');
  }
  // TODO: Check valid password
  const isPasswordValid = await verifyPassword(input.password, user.passwordHash);
  if (!isPasswordValid) {
    throw new HttpError(401, 'Invalid email or password');
  }
  // TODO: create new refresh token, invalidate old ones if needed
  const refreshTokenReport = await createRefreshToken(user.id);
  const accessToken = signAccessToken({ sub: user.id, email: user.email });
  const refreshToken = signRefreshToken({ sub: user.id, tokenId: refreshTokenReport.tokenId });

  return { accessToken, refreshToken };
};

export const refreshTokens = async (refreshToken: string): Promise<AuthTokens> => {
  // TODO: Get refresh token record
  const payload = verifyRefreshToken(refreshToken);

  const record = await RefreshToken.findOne({
    where: { tokenId: payload.tokenId, userCredentialId: payload.sub },
  });

  // TODO: Check if token is valid and not expired
  if (!record) {
    throw new HttpError(401, 'Invalid refresh token');
  }

  if (record.expiresAt < new Date()) {
    await record.destroy(); // Clean up expired token
    throw new HttpError(401, 'Refresh token expired');
  }
  // TODO: Get user credentials and check user has refresh token
  const user = await UserCredentials.findByPk(payload.sub);

  if (!user) {
    logger.warn({ userId: payload.sub }, 'User not found for refresh token');
    throw new HttpError(401, 'Invalid refresh token');
  }

  // TODO: Create new refresh token record
  await record.destroy(); // Invalidate old refresh token
  const newRefreshTokenRecord = await createRefreshToken(user.id);

  return {
    accessToken: signAccessToken({ sub: user.id, email: user.email }),
    refreshToken: signRefreshToken({ sub: user.id, tokenId: newRefreshTokenRecord.tokenId }),
  };
};

export const revokeRefreshTokens = async (userId: string): Promise<void> => {
  await RefreshToken.destroy({ where: { userCredentialId: userId } });
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
