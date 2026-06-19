import { env } from '@/config/env';
import { HttpError } from '@chat-app-be/common';
import axios from 'axios';

const client = axios.create({
  baseURL: env.USER_SERVICE_URL,
  timeout: 5000,
});

const userHeader = {
  headers: {
    'x-internal-token': env.INTERNAL_API_TOKEN,
  },
} as const;

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  updateAt: string;
}

export interface UserResponse {
  data: UserDto;
}

export interface UserListResponse {
  data: UserDto[];
}

export interface CreateUserPayload {
  email: string;
  displayName: string;
}

export interface SearchUsersParams {
  query: string;
  limit?: number;
  exclude?: string[];
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
    ? 'User service is currently unavailable'
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

export const userProxyService = {
  createUser(payload: CreateUserPayload): Promise<UserResponse> {
    return createUserProxy(payload).catch(handleAxiosError);
  },
  searchUser(payload: SearchUsersParams): Promise<UserListResponse> {
    return searchUserProxy(payload).catch(handleAxiosError);
  },
  getUserId(id: string): Promise<UserResponse> {
    return getUserByIdProxy(id).catch(handleAxiosError);
  },
  getAllUser(): Promise<UserListResponse> {
    return getUserProxy().catch(handleAxiosError);
  },
};

export const getUserProxy = async (): Promise<UserListResponse> => {
  const response = await client.get<UserListResponse>('/users', userHeader);
  return response.data;
};

export const getUserByIdProxy = async (id: string): Promise<UserResponse> => {
  const response = await client.get<UserResponse>('/users/:id', userHeader);
  return response.data;
};

export const createUserProxy = async (payload: CreateUserPayload): Promise<UserResponse> => {
  const response = await client.post<UserResponse>('/users', payload, userHeader);
  return response.data;
};
export const searchUserProxy = async (query: SearchUsersParams): Promise<UserListResponse> => {
  const response = await client.get<UserListResponse>('/users/search', {
    headers: userHeader.headers,
    params: {
      query: query.query,
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.exclude && query.exclude.length > 0 ? { exclude: query.exclude } : {}),
    },
  });
  return response.data;
};
