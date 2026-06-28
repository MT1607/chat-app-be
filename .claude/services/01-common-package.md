# `@chatapp/common` — Shared Library

> **Vị trí:** `packages/common/`  
> **Package name:** `@chatapp/common`  
> **Type:** ESM (`"type": "module"`)  
> **Build:** `tsc` + `tsc-alias` (resolve path aliases trong output)  
> **Dependencies:** `express`, `pino`, `pino-pretty`, `zod`

Package dùng chung được import bởi **tất cả 4 services**. Đây là nơi tập trung các utility, middleware, error class, event types và logger — giúp tránh duplicate code giữa các service.

---

## Cấu trúc file

```
packages/common/src/
├── index.ts              ← Barrel export tất cả
├── env.ts                ← createEnv() factory
├── logger.ts             ← Pino logger factory
├── errors/
│   └── http-error.ts     ← HttpError class
├── events/
│   ├── event-types.ts    ← Interface DomainEvent, OutboundEvent, InBoundEvent
│   ├── auth-events.ts    ← Auth event constants + payload types
│   └── user-events.ts    ← User event constants + payload types
└── http/
    ├── async-handler.ts  ← Express async wrapper
    ├── auth.ts           ← AuthenticatedUser interface + USER_ID_HEADER
    ├── internal-auth.ts  ← Internal token middleware factory
    └── validate-request.ts ← Zod validation middleware
```

---

## `index.ts` — Barrel Export

```ts
export * from './env';
export * from './logger';
export * from './errors/http-error';
export * from './http/async-handler';
export * from './http/validate-request';
export * from './http/internal-auth';
export * from './http/auth';
export * from './events/event-types';
export * from './events/user-events';
export * from './events/auth-events';
export { z } from 'zod';
export type { Logger } from 'pino';
```

Re-export `z` từ Zod và `Logger` type từ Pino để các service không cần import trực tiếp từ những thư viện đó — mọi thứ đi qua `@chatapp/common`.

---

## `env.ts` — Environment Validator

```ts
export const createEnv = <TSchema extends ZodRawShape>(
  schema: ZodObject<TSchema>,
  options: EnvOptions = {}
): SchemaOutput<TSchema> => {
  const { source = process.env, serviceName = 'service' } = options;

  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const formatedErrors = parsed.error.format();
    throw new Error(
      `[${serviceName}] Environment variable validation failed: ${JSON.stringify(formatedErrors)}`
    );
  }

  return parsed.data;
};
```

### Mục đích

Factory tạo và validate env vars ngay khi service khởi động. Nếu thiếu hoặc sai format bất kỳ biến nào → throw Error ngay, service không start được — fail-fast pattern.

### Cách dùng trong từng service

```ts
// services/gateway-service/src/config/env.ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
  JWT_SECRET: z.string().min(32),
  INTERNAL_API_TOKEN: z.string().min(16),
  // ...
});

export const env = createEnv(envSchema, { serviceName: 'gateway-service' });
```

`z.coerce.number()` tự động chuyển string `"4000"` → `4000`, vì env vars luôn là string.

---

## `errors/http-error.ts` — Custom Error Class

```ts
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
```

### Cách hoạt động

`HttpError` là error class duy nhất được throw trong toàn bộ hệ thống. Tất cả service đều có `errorHandler` middleware xử lý nó:

```ts
// pattern dùng trong mọi service
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const error = err instanceof HttpError ? err : undefined;
  const statusCode = error?.statusCode ?? 500;

  // 5xx → ẩn message thật (bảo mật), trả về generic message
  const message = statusCode >= 500
    ? 'Internal Server Error'
    : (error?.message ?? 'Unknown Error');

  // Nếu có details (ví dụ validation errors) → đính kèm vào response
  const payload = error?.details
    ? { message, details: error.details }
    : { message };

  res.status(statusCode).json(payload);
};
```

### Ví dụ sử dụng

```ts
throw new HttpError(404, 'Conversation not found');
throw new HttpError(409, 'User with this email already exists');
throw new HttpError(422, 'Validation Error', { issues: [...] });
throw new HttpError(401, 'Unauthorized');
throw new HttpError(403, 'Sender is not part of this conversation');
```

---

## `http/async-handler.ts` — Express Async Wrapper

```ts
export type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export const asyncHandler = (handler: AsyncHandler): RequestHandler => {
  return (req, res, next) => {
    void handler(req, res, next).catch((error: unknown) => {
      next(toError(error));
    });
  };
};
```

### Vấn đề giải quyết

Express 4 không tự catch lỗi trong async handler. Nếu không dùng wrapper này, một unhandled rejection sẽ crash server. `asyncHandler` bọc handler lại, catch mọi lỗi và forward đến `next()` → `errorHandler` xử lý.

### Ví dụ

```ts
// Không có asyncHandler — phải try/catch thủ công
router.get('/:id', async (req, res, next) => {
  try {
    const data = await someService.findById(req.params.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Có asyncHandler — clean hơn
router.get('/:id', asyncHandler(async (req, res) => {
  const data = await someService.findById(req.params.id);
  res.json(data);
}));
```

> **Lưu ý:** Express 5 (đang dùng trong repo này — `"express": "^5.1.0"`) đã tự xử lý async errors, nhưng `asyncHandler` vẫn được giữ để tương thích.

---

## `http/validate-request.ts` — Zod Validation Middleware

```ts
export interface RequestValidationSchemas {
  body?: Schema;
  params?: Schema;
  query?: Schema;
}

export const validateRequest = (schemas: RequestValidationSchemas) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body)   req.body   = schemas.body.parse(req.body);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query)  req.query  = schemas.query.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new HttpError(422, 'Validation Error', {
          issues: error.errors.map(issue => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        }));
        return;
      }
      next(error);
    }
  };
};
```

### Đặc điểm

- Validate và **replace** `req.body` / `req.params` / `req.query` bằng parsed value → downstream handlers nhận được data đã được type-safe.
- Khi Zod parse thành công, nó cũng áp dụng transforms (`.coerce`, `.trim()`, `.default()`, etc.).
- Lỗi validation → 422 với danh sách issues chi tiết.

### Ví dụ response 422

```json
{
  "message": "Validation Error",
  "details": {
    "issues": [
      { "path": "email", "message": "Invalid email" },
      { "path": "password", "message": "String must contain at least 8 character(s)" }
    ]
  }
}
```

---

## `http/internal-auth.ts` — Internal Token Middleware

```ts
export const createInternalAuthMiddleware = (
  expectedToken: string,
  options: InternalAuthOptions = {},
): RequestHandler => {
  const headerName = options.headerName?.toLowerCase() ?? 'x-internal-token';
  const exemptPaths = new Set(options.exemptPaths ?? []);

  return (req, _res, next) => {
    if (exemptPaths.has(req.path)) {
      next();
      return;
    }

    const provided = req.headers[headerName];
    const token = Array.isArray(provided) ? provided[0] : provided;

    if (typeof token !== 'string' || token !== expectedToken) {
      next(new HttpError(401, 'Unauthorized'));
      return;
    }

    next();
  };
};
```

### Mục đích

Bảo vệ các internal services (Auth, User, Chat) không bị gọi trực tiếp từ bên ngoài mà không qua Gateway. Gateway phải đính kèm header `X-Internal-Token` với giá trị đúng thì request mới được chấp nhận.

### Cách dùng

```ts
// auth-service/src/app.ts
app.use(
  createInternalAuthMiddleware(env.INTERNAL_API_TOKEN, {
    exemptPaths: ['/health'],   // /health không cần token (cho Docker healthcheck)
  }),
);
```

### Security flow

```
External client → Gateway (validate JWT) → Auth/User/Chat Service (validate X-Internal-Token)
                                         ↑
                              Blocked nếu không có token đúng
```

---

## `http/auth.ts` — Authenticated User Interface

```ts
export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export const USER_ID_HEADER = 'x-user-id';
```

- `AuthenticatedUser`: type của `req.user` sau khi qua auth middleware.
- `USER_ID_HEADER`: constant tên header (`'x-user-id'`) dùng để Gateway truyền userId đến internal services. Dùng constant thay vì hardcode string để tránh lỗi typo.

---

## `events/event-types.ts` — Base Event Interfaces

```ts
export type EventPayload = Record<string, unknown>;

// Event được publish ra (từ Auth/User service)
export interface OutboundEvent<TType extends string, TPayload extends EventPayload>
  extends DomainEvent<TType, TPayload> {
  metadata?: EventMetadata;
}

// Event được nhận vào (consumer side)
export interface InBoundEvent<TType extends string, TPayload extends EventPayload>
  extends DomainEvent<TType, TPayload> {
  metadata: EventMetadata;   // metadata bắt buộc khi nhận
}

export interface EventMetadata {
  correlationId?: string;   // trace request xuyên services
  causationId?: string;     // event nào gây ra event này
  version?: number;         // schema versioning
}
```

Generic pattern `DomainEvent<TType, TPayload>` giúp type-safe cho từng loại event cụ thể.

---

## `events/auth-events.ts` — Auth Service Events

```ts
export const AUTH_EVENT_EXCHANGE = 'auth.events';
export const AUTH_USER_REGISTERED_ROUTING_KEY = 'auth.user.registered';

export interface AuthUserRegisteredPayload extends EventPayload {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export type AuthRegisteredEvent = OutboundEvent<
  typeof AUTH_USER_REGISTERED_ROUTING_KEY,
  AuthUserRegisteredPayload
>;
```

**Publisher:** Auth Service → publish khi user đăng ký thành công.  
**Consumer:** User Service → nhận để sync profile vào PostgreSQL.

---

## `events/user-events.ts` — User Service Events

```ts
export const USER_EVENTS_EXCHANGE = 'user.events';
export const USER_CREATED_ROUTING_KEY = 'user.created';

export interface UserCreatedPayload extends EventPayload {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export type UserCreatedEvent = OutboundEvent<typeof USER_CREATED_ROUTING_KEY, UserCreatedPayload>;
```

**Publisher:** User Service → publish sau khi sync user từ auth event.  
**Consumer:** Chat Service → nhận để cache user info trong MongoDB collection `users`.

---

## `logger.ts` — Pino Logger Factory

```ts
export const createLogger = (options: CreateLoggerOptions): Logger => {
  const { name, ...rest } = options;

  const transport =
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }
      : undefined;   // production: raw JSON

  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    transport,
    ...rest,
  });
};
```

- **Development:** `pino-pretty` với màu sắc, timestamp dạng `2024-01-01 12:00:00` — dễ đọc khi dev.
- **Production:** raw JSON — dễ parse bởi log aggregation tools (Datadog, ELK, etc.).
- `LOG_LEVEL` từ env cho phép toggle verbose logging mà không cần redeploy.

### Cách dùng trong service

```ts
// mỗi service tạo logger riêng với tên service
export const logger = createLogger({ name: 'auth-service' });

// usage
logger.info({ port }, 'Auth service is running');
logger.error({ err: error }, 'Failed to process auth event');
logger.warn('RabbitMQ channel is not initialized');
logger.debug({ sequelize: msg });  // chỉ hiện khi LOG_LEVEL=debug
```

---

## Dependency Graph

```
@chatapp/common
    ↑ import by
    ├── gateway-service
    ├── auth-service
    ├── user-service
    └── chat-service
```

Tất cả services đều khai báo `"@chatapp/common": "workspace:^"` trong `dependencies`, trỏ về package local trong monorepo.
