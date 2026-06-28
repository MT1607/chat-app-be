# Gateway Service — API Gateway

> **Port:** 4000  
> **Vị trí:** `services/gateway-service/`  
> **Database:** Không có  
> **Role:** Public entry point duy nhất của toàn hệ thống  
> **Dependencies chính:** `express ^5.1.0`, `axios ^1.13.2`, `jsonwebtoken ^9.0.2`, `helmet`, `cors`

---

## Tổng quan

Gateway Service là **cửa ngõ duy nhất** mà client bên ngoài được phép gọi vào. Nó không có database riêng — toàn bộ nghiệp vụ được proxy sang các internal services. Nhiệm vụ chính:

1. **Validate JWT** từ `Authorization: Bearer <token>` header
2. **Route request** đến Auth / User / Chat service qua HTTP
3. **Truyền userId** xuống internal services qua header `x-user-id`
4. **Transform lỗi** từ internal services thành response chuẩn cho client

---

## Cấu trúc file

```
services/gateway-service/src/
├── index.ts                        ← Bootstrap server
├── app.ts                          ← Express app factory
├── config/
│   └── env.ts                      ← Env validation
├── types/
│   └── express.d.ts                ← Augment req.user type
├── middleware/
│   ├── require-auth.ts             ← JWT validation middleware
│   └── error-handler.ts            ← Global error handler
├── routes/
│   ├── index.ts                    ← Route registration
│   ├── auth.routes.ts              ← /auth/*
│   ├── user.routes.ts              ← /users/*
│   └── conversation.routes.ts      ← /conversations/*
├── controllers/
│   ├── auth.controller.ts          ← Auth request handlers
│   ├── user.controller.ts          ← User request handlers
│   └── conversation.controller.ts  ← Conversation + Message handlers
├── services/
│   ├── auth-proxy.service.ts       ← HTTP client → Auth Service
│   ├── user-proxy.service.ts       ← HTTP client → User Service
│   └── chat-proxy.service.ts       ← HTTP client → Chat Service
├── validation/
│   ├── auth.schema.ts
│   ├── user.schema.ts
│   ├── conversation.schema.ts
│   └── message.schema.ts
└── utils/
    └── auth.ts                     ← getAuthenticatedUser helper
```

---

## `index.ts` — Bootstrap

```ts
const main = async () => {
  const app = createApp();
  const server = createServer(app);

  server.listen(env.GATEWAY_PORT, () => {
    logger.info({ port: env.GATEWAY_PORT }, 'Gateway service is running');
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};
```

Gateway không có database nên startup đơn giản hơn các service khác — không cần `await connectToDatabase()`. Graceful shutdown chỉ cần đóng HTTP server.

---

## `app.ts` — Express App Factory

```ts
export const createApp = (): Application => {
  const app = express();

  app.use(helmet());           // Security headers: X-Frame-Options, CSP, etc.
  app.use(cors({               // CORS: cho phép tất cả origins (dev config)
    origin: '*',
    credentials: true,
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // KHÔNG có createInternalAuthMiddleware ở đây
  // Gateway là public service → không cần x-internal-token

  registerRoutes(app);

  app.use((_req, res) => res.status(404).json({ message: 'Not Found' }));
  app.use(errorHandler);

  return app;
};
```

**Khác biệt quan trọng với các internal services:** Gateway không dùng `createInternalAuthMiddleware`. Thay vào đó từng route cụ thể dùng `requireAuth` middleware.

---

## `config/env.ts` — Environment Config

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_PORT:        z.coerce.number().int().min(0).max(65_535).default(4000),
  USER_SERVICE_URL:    z.string().url(),      // "http://user-service:4001"
  AUTH_SERVICE_URL:    z.string().url(),      // "http://auth-service:4003"
  CHAT_SERVICE_URL:    z.string().url(),      // "http://chat-service:4002"
  JWT_SECRET:          z.string().min(32),    // phải ≥ 32 chars
  INTERNAL_API_TOKEN:  z.string().min(16),    // phải ≥ 16 chars
});
```

Gateway cần `JWT_SECRET` để verify token (không sign), và `INTERNAL_API_TOKEN` để gửi kèm khi forward request sang internal services.

---

## `types/express.d.ts` — Type Augmentation

```ts
import type { AuthenticatedUser } from '@chatapp/common';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;  // { id: string; email?: string }
    }
  }
}
```

Augment Express `Request` interface để TypeScript hiểu `req.user` sau khi qua `requireAuth` middleware.

---

## `middleware/require-auth.ts` — JWT Middleware

```ts
export const requireAuth: RequestHandler = (req, _res, next) => {
  try {
    const token = parseAuthorizationHeader(req.headers.authorization);
    const claims = jwt.verify(token, env.JWT_SECRET) as AccessTokenClaims;
    req.user = toAuthenticatedUser(claims);
    next();
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }
    next(new HttpError(401, 'Unauthorized'));
  }
};
```

### Hàm helper bên trong

```ts
// Parse "Bearer <token>" → "<token>"
const parseAuthorizationHeader = (value: string | undefined): string => {
  if (!value) throw new HttpError(401, 'Unauthorized');

  const [scheme, token] = value.split(' ');
  if (scheme.toLowerCase() !== 'bearer' || !token) {
    throw new HttpError(401, 'Unauthorized');
  }
  return token;
};

// JWT claims → AuthenticatedUser object
const toAuthenticatedUser = (claims: AccessTokenClaims): AuthenticatedUser => {
  if (!claims.sub) throw new HttpError(401, 'Unauthorized');
  return { id: claims.sub, email: claims.email };
};
```

### Luồng xử lý

```
Request
  → parseAuthorizationHeader()  → Lỗi: 401 nếu thiếu/sai format
  → jwt.verify()                → Lỗi: 401 nếu token invalid/expired
  → toAuthenticatedUser()       → Lỗi: 401 nếu thiếu sub claim
  → req.user = { id, email }
  → next()
```

---

## `middleware/error-handler.ts` — Global Error Handler

```ts
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error({ err }, 'Unhandled error occurred');

  const error = err instanceof HttpError ? err : undefined;
  const statusCode = error?.statusCode ?? 500;

  // 5xx: ẩn message thật để tránh leak thông tin nội bộ
  const message = statusCode >= 500
    ? 'Internal Server Error'
    : (error?.message ?? 'Unknown Error');

  const payload = error?.details
    ? { message, details: error.details }
    : { message };

  res.status(statusCode).json(payload);
};
```

Catch mọi error được forward qua `next(error)`. Non-HttpError (unexpected errors) → luôn trả 500.

---

## `routes/index.ts` — Route Registration

```ts
export const registerRoutes = (app: Router) => {
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'gateway-service' });
  });

  app.use('/auth', authRouter);             // Không cần auth
  app.use('/conversations', conversationRouter);  // Cần auth (middleware ở router level)
  app.use('/users', userRouter);            // Auth per-route
};
```

---

## Routes chi tiết

### `routes/auth.routes.ts`

```ts
authRouter.post('/register', validateRequest({ body: registerSchema }), asyncHandler(registerUser));
authRouter.post('/login',    validateRequest({ body: loginSchema }),    asyncHandler(loginUser));
authRouter.post('/refresh',  validateRequest({ body: refreshSchema }),  asyncHandler(refreshTokens));
authRouter.post('/revoke',   validateRequest({ body: revokeSchema }),   asyncHandler(revokeTokens));
```

Auth routes **không cần** `requireAuth` — là các endpoints public.

### `routes/conversation.routes.ts`

```ts
conversationRouter.use(requireAuth);  // Áp dụng cho TẤT CẢ conversation routes

conversationRouter.post('/', validateRequest({ body: createConversationBodySchema }), createConversationHandler);
conversationRouter.get('/',  validateRequest({ query: listConversationsQuerySchema }), listConversationsHandler);
conversationRouter.get('/:id', validateRequest({ params: conversationIdParamsSchema }), getConversationHandler);
conversationRouter.post('/:id/messages', validateRequest({ params: ..., body: ... }), createMessageHandler);
conversationRouter.get( '/:id/messages', validateRequest({ params: ..., query: ... }), listMessagesHandler);
```

`requireAuth` được mount ở router level → tất cả conversation routes đều yêu cầu JWT.

### `routes/user.routes.ts`

```ts
userRouter.get('/',        requireAuth, asyncHandler(getAllUsers));
userRouter.get('/search',  requireAuth, validateRequest({ query: searchUsersQuerySchema }), asyncHandler(searchUsers));
userRouter.get('/:id',     requireAuth, validateRequest({ params: userIdParamsSchema }), asyncHandler(getUser));
userRouter.post('/',       validateRequest({ body: createUserSchema }), asyncHandler(createUser));  // Không cần auth
```

`POST /users` không cần auth — dùng để tạo user (thường là từ internal services, nhưng endpoint này không protected).

---

## Proxy Services

### `services/auth-proxy.service.ts`

```ts
const client = axios.create({
  baseURL: env.AUTH_SERVICE_URL,  // "http://auth-service:4003"
  timeout: 5000,
});

const authHeader = {
  headers: { 'X-Internal-Token': env.INTERNAL_API_TOKEN },
};
```

| Method | Axios call | Mô tả |
|--------|-----------|--------|
| `register(payload)` | `POST /auth/register` | Forward đăng ký |
| `login(payload)` | `POST /auth/login` | Forward đăng nhập |
| `refresh(payload)` | `POST /auth/refresh` | Forward refresh token |
| `revoke(payload)` | `POST /auth/revoke` | Forward revoke token |

### `services/user-proxy.service.ts`

```ts
const client = axios.create({
  baseURL: env.USER_SERVICE_URL,  // "http://user-service:4001"
  timeout: 5000,
});
```

| Method | Axios call | Mô tả |
|--------|-----------|--------|
| `getUserById(id)` | `GET /users/:id` | Lấy user theo ID |
| `getAllUsers()` | `GET /users` | Lấy tất cả users |
| `createUser(payload)` | `POST /users` | Tạo user |
| `searchUsers(params)` | `GET /users/search?query=&limit=&exclude=` | Tìm kiếm |

### `services/chat-proxy.service.ts`

```ts
const client = axios.create({
  baseURL: env.CHAT_SERVICE_URL,  // "http://chat-service:4002"
  timeout: 5000,
  headers: { 'X-Internal-Token': env.INTERNAL_API_TOKEN },
});
```

Đặc biệt: Chat proxy truyền thêm `USER_ID_HEADER` (`x-user-id`) cho từng request để Chat Service biết ai đang thực hiện hành động:

```ts
await client.post('/conversations', payload, {
  headers: { [USER_ID_HEADER]: userId },  // 'x-user-id': 'uuid...'
});
```

| Method | Axios call | Header thêm |
|--------|-----------|------------|
| `createConversation(userId, payload)` | `POST /conversations` | `x-user-id` |
| `listConversations(userId)` | `GET /conversations` | `x-user-id` |
| `getConversation(id, userId)` | `GET /conversations/:id` | `x-user-id` |
| `createMessage(convId, userId, payload)` | `POST /conversations/:id/messages` | `x-user-id` |
| `listMessages(convId, userId, query)` | `GET /conversations/:id/messages` | `x-user-id` |

### Error handling trong Proxy Services

```ts
const handleAxiosError = (error: unknown): never => {
  if (!axios.isAxiosError(error) || !error.response) {
    throw new HttpError(500, 'Authentication service is unavailable');
  }
  const { status, data } = error.response;
  throw new HttpError(status, resolvedMessage(status, data));
};
```

Axios error từ internal services → re-throw thành `HttpError` với cùng status code → `errorHandler` middleware xử lý thống nhất.

---

## Controllers

### `controllers/auth.controller.ts`

```ts
export const registerUser: AsyncHandler = async (req, res, next) => {
  try {
    const payload = registerSchema.parse(req.body);
    const response = await authProxyService.register(payload);
    res.status(201).json(response);
  } catch (error) { next(error); }
};
```

Mỗi controller:
1. Parse/validate body từ Zod schema (đã được validate bởi middleware rồi nhưng re-parse để lấy type)
2. Gọi proxy service tương ứng
3. Forward response về client

### `controllers/conversation.controller.ts`

```ts
export const createConversationHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);           // lấy req.user
  const payload = createConversationBodySchema.parse(req.body);

  // Đảm bảo creator cũng nằm trong participants
  const uniqueParticipantIds = Array.from(new Set([...payload.participantIds, user.id]));

  if (uniqueParticipantIds.length < 2) {
    throw new HttpError(400, 'Conversation must atleast include one other participant');
  }

  const conversation = await chatProxyService.createConversation(user.id, {
    title: payload.title,
    participantIds: uniqueParticipantIds,
  });

  res.status(201).json({ data: conversation });
});
```

```ts
export const listConversationsHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { participantId } = listConversationsQuerySchema.parse(req.query);

  // Bảo vệ: user chỉ được xem conversation của chính mình
  if (participantId && participantId !== user.id) {
    throw new HttpError(403, 'Cannot list conversations for another user');
  }

  const conversations = await chatProxyService.listConversations(user.id);
  res.json({ data: conversations });
});
```

```ts
export const getConversationHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { id } = conversationIdParamsSchema.parse(req.params);
  const conversation = await chatProxyService.getConversation(id, user.id);

  // Double-check: user phải là participant
  if (!conversation.participantIds.includes(user.id)) {
    throw new HttpError(403, 'You are not a participant in this conversation');
  }

  res.json({ data: conversation });
});
```

### `controllers/user.controller.ts`

```ts
export const searchUsers: AsyncHandler = async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req);
    const { query, limit, exclude } = searchUsersQuerySchema.parse(req.query);

    // Luôn exclude chính user đang search khỏi kết quả
    const sanitizedExclude = Array.from(new Set([...exclude, user.id]));

    const users = await userProxyService.searchUsers({ query, limit, exclude: sanitizedExclude });
    res.json({ data: users });
  } catch (error) { next(error); }
};
```

---

## Validation Schemas

### `validation/auth.schema.ts`

```ts
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(3).max(30),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const refreshSchema = z.object({ refreshToken: z.string() });
export const revokeSchema  = z.object({ userId: z.string().uuid() });
```

### `validation/conversation.schema.ts`

```ts
export const createConversationBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  participantIds: z.array(z.string().uuid()).min(1),  // ít nhất 1 participant khác
});

export const listConversationsQuerySchema = z.object({
  participantId: z.string().uuid().optional(),
});

export const conversationIdParamsSchema = z.object({
  id: z.string().uuid(),
});
```

### `validation/message.schema.ts`

```ts
export const createMessageBodySchema = z.object({
  body: z.string().min(1).max(2000),
});

export const listMessagesQuerySchema = z.object({
  limit: z.preprocess(
    (value) => (value === undefined ? undefined : Number(value)),
    z.number().int().min(1).max(200),
  ).optional(),
  after: z.string().datetime().optional(),  // ISO 8601 datetime string
});
```

`z.preprocess` chuyển string query param `"50"` → number `50` trước khi validate.

### `validation/user.schema.ts`

```ts
const excludeSchema = z.union([
  z.array(z.string().uuid()),
  z.string().uuid()
    .transform((value) => [value])  // single UUID → array
    .optional()
    .transform((value) => value ?? []),  // undefined → []
]);

export const searchUsersQuerySchema = z.object({
  query: z.string().trim().min(3).max(255),
  limit: z.union([z.string(), z.number()])
    .transform((value) => Number())   // ⚠️ Bug: Number() thay vì Number(value)
    .refine((value) => Number.isInteger(value) && value > 0 && value <= 25)
    .optional(),
  exclude: excludeSchema,
});
```

> ⚠️ **Bug trong `limit`:** `.transform((value) => Number())` — `Number()` không nhận argument, luôn trả về `0`. Phải là `Number(value)`. Kết quả là `limit` luôn fail refine (`0 > 0` = false) → bị bỏ qua (vì `.optional()`).

---

## `utils/auth.ts`

```ts
export const getAuthenticatedUser = (req: Request): AuthenticatedUser => {
  if (!req.user) {
    throw new HttpError(401, 'Unauthorized');
  }
  return req.user;
};
```

Helper lấy `req.user` với type safety. Throw 401 nếu `requireAuth` chưa chạy (route config sai).

---

## Luồng request đầy đủ

```
POST /conversations
  → validateRequest({ body: createConversationBodySchema })
  → requireAuth (verify JWT → req.user)
  → createConversationHandler
      → getAuthenticatedUser(req) → { id: 'uuid', email: '...' }
      → parse + validate body
      → dedup participantIds + add currentUser.id
      → chatProxyService.createConversation(userId, payload)
          → axios.post('http://chat-service:4002/conversations', payload, {
              headers: {
                'X-Internal-Token': 'secret',
                'x-user-id': 'uuid'
              }
            })
      → res.status(201).json({ data: conversation })
```

---

## Request/Response format

### Tất cả successful responses có wrapper

```json
{ "data": { ... } }         // single resource
{ "data": [ ... ] }         // list resource
```

Ngoại lệ: Auth endpoints trả về flat object (không có `data` wrapper):
```json
{ "accessToken": "...", "refreshToken": "...", "user": { ... } }
```

### Error response

```json
{ "message": "Error description" }
{ "message": "Validation Error", "details": { "issues": [...] } }
```
