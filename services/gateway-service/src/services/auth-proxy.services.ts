import { env } from '@/config/env';
import { HttpError } from '@chat-app-be/common/src';
import axios from 'axios';

const client = axios.create({
  baseURL: env.AUTH_SERVICE_URL,
  timeout: 5000,
});

const authHeader = {
  headers: {
    'x-internal-token': env.INTERNAL_AUTH_TOKEN,
  },
} as const;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthData {
  userId: string;
  email: string;
  displayName: string;
}

export interface AuthResponse extends AuthTokens {
  user: AuthData;
}

export interface RegisterPayload {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RefreshPayload {
  refreshToken: string;
}

export interface RevokePayload {
  userId: string;
}

const resolvedMessage = (status: number, data: unknown) => {
  // Implementation for handling resolved messages
  if (typeof data === 'object' && data && 'message' in data) {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }

  return status >= 500
    ? 'Authentication service is currently unavailable'
    : 'An error occurred while processing the request';
};

const handleAxiosError = (error: unknown) => {
  if (!axios.isAxiosError(error) || !error.response) {
    throw new HttpError(500, 'Authentication service is currently unavailable');
  }

  const { status, data } = error.response as { status: number; data: unknown };
  const message = resolvedMessage(status, data);
  throw new HttpError(status, message);
};

export const authProxyService = {
  register(payload: RegisterPayload): Promise<AuthResponse> {
    return registerProxy(payload).catch(handleAxiosError);
  },
  login(payload: LoginPayload): Promise<AuthResponse> {
    return loginProxy(payload).catch(handleAxiosError);
  },
  refreshTokens(payload: RefreshPayload): Promise<AuthResponse> {
    return refreshTokensProxy(payload).catch(handleAxiosError);
  },
  revokeTokens(payload: RevokePayload): Promise<void> {
    return revokeTokensProxy(payload).catch(handleAxiosError);
  },
};

export const registerProxy = async (payload: RegisterPayload): Promise<AuthResponse> => {
  const response = await client.post<AuthResponse>('/auth/register', payload, authHeader);
  return response.data;
};

export const loginProxy = async (payload: LoginPayload): Promise<AuthResponse> => {
  const response = await client.post<AuthResponse>('/auth/login', payload, authHeader);
  return response.data;
};

export const refreshTokensProxy = async (payload: RefreshPayload): Promise<AuthResponse> => {
  const response = await client.post<AuthResponse>('/auth/refresh', payload, authHeader);
  return response.data;
};

export const revokeTokensProxy = async (payload: RevokePayload): Promise<void> => {
  await client.post('/auth/revoke', payload, authHeader);
};
