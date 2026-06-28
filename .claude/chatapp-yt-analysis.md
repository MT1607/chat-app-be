# Phân tích Repo: `fiston-user/chatapp-yt`

> **Repository:** https://github.com/fiston-user/chatapp-yt  
> **Ngôn ngữ:** TypeScript (92.8%), Dockerfile (7.1%), JavaScript (0.1%)  
> **Package Manager:** pnpm 10 (workspaces)  
> **Runtime:** Node.js 22  

---

## 1. Tổng quan kiến trúc

Đây là một ứng dụng chat **production-ready** theo mô hình **microservices**, triển khai pattern **API Gateway** kết hợp **Event-Driven Architecture**. Toàn bộ hệ thống được container hóa bằng Docker Compose.

```
Client
  │
  ▼
┌─────────────────────────────┐
│   Gateway Service (:4000)   │  ← Public entry point
│   JWT validation, routing   │
└──────┬──────────┬───────────┘
       │HTTP      │HTTP
  ┌────▼───┐  ┌───▼──────┐  ┌────────────┐
  │  Auth  │  │   User   │  │    Chat    │
  │ :4003  │  │  :4001   │  │   :4002   │
  │ MySQL  │  │ Postgres │  │  MongoDB  │
  └────┬───┘  └────▲─────┘  │  + Redis  │
       │            │         └────────────┘
       └────────────┘
          RabbitMQ
       (auth.user.registered)
```

**Luồng dữ liệu chính:**
1. Client gửi request đến Gateway (port 4000).
2. Gateway xác thực JWT, forward request đến service tương ứng qua HTTP nội bộ.
3. Auth Service publish event lên RabbitMQ khi user đăng ký.
4. User Service consume event đó để sync profile.

---

## 2. Cấu trúc thư mục

```
chatapp-yt/
├── packages/
│   └── common/                   # Shared library
│       └── src/
│           ├── index.ts          # Barrel export
│           ├── env.ts
│           ├── logger.ts         # Pino logger factory
│           ├── errors/
│           │   └── http-error.ts
│           ├── events/
│           │   ├── event-types.ts
│           │   ├── auth-events.ts
│           │   └── user-events.ts
│           └── http/
│               ├── async-handler.ts
│               ├── auth.ts
│               ├── internal-auth.ts
│               └── validate-request.ts
│
├── services/
│   ├── gateway-service/          # API Gateway (port 4000)
│   ├── auth-service/             # Auth (port 4003)
│   ├── user-service/             # User profile (port 4001)
│   └── chat-service/             # Chat + Messages (port 4002)
│
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .env.example
```

---

## 3. Package Common (`@chatapp/common`)

Thư viện dùng chung được import bởi tất cả services.

### 3.1 `HttpError`

```ts
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>
  ) { ... }
}
```

Custom error class thống nhất, được throw trong các services và bắt bởi `errorHandler` middleware.

### 3.2 `asyncHandler`

```ts
export const asyncHandler = (handler: AsyncHandler): RequestHandler => {
  return (req, res, next) => {
    void handler(req, res, next).catch((error) => next(toError(error)));
  };
};
```

Wrapper cho Express route handler async, tự động forward error đến `next()`.

### 3.3 `validateRequest`

```ts
export const validateRequest = (schemas: RequestValidationSchemas) => {
  return (req, _res, next) => {
    // parse body / params / query bằng Zod
    // throw HttpError(422) nếu validation fail
  };
};
```

Middleware validation dùng Zod, hỗ trợ validate `body`, `params`, `query` cùng lúc.

### 3.4 `createInternalAuthMiddleware`

```ts
export const createInternalAuthMiddleware = (
  expectedToken: string,
  options: InternalAuthOptions = {},
): RequestHandler => { ... }
```

Middleware bảo vệ internal endpoints. So sánh header `x-internal-token` với `INTERNAL_API_TOKEN` từ env. Có thể exempt một số path (ví dụ `/health`).

### 3.5 Event Types (RabbitMQ)

```ts
// auth-events.ts
export const AUTH_EVENT_EXCHANGE = 'auth.events';
export const AUTH_USER_REGISTERED_ROUTING_KEY = 'auth.user.registered';

export interface AuthUserRegisteredPayload {
  id: string; email: string; displayName: string; createdAt: string;
}

// user-events.ts
export const USER_EVENTS_EXCHANGE = 'user.events';
export const USER_CREATED_ROUTING_KEY = 'user.created';
```

Các event constants và payload types được chia sẻ giữa publisher (Auth Service) và consumer (User Service).

### 3.6 `createLogger`

```ts
export const createLogger = (options: CreateLoggerOptions): Logger => {
  // dev: pino-pretty (colorize)
  // prod: plain JSON
}
```

Factory tạo Pino logger với format khác nhau theo `NODE_ENV`.

---

## 4. Gateway Service (Port 4000)

Public entry point duy nhất. Không có database riêng — chỉ proxy request.

### 4.1 `app.ts`

```ts
export const createApp = (): Application => {
  app.use(helmet());
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json());
  // Không có internal auth middleware (đây là public gateway)
  registerRoutes(app);
  app.use(errorHandler);
};
```

**Lưu ý:** Gateway không dùng `createInternalAuthMiddleware` vì đây là public service. Thay vào đó, nó dùng `requireAuth` middleware để validate JWT.

### 4.2 `requireAuth` Middleware

```ts
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = parseAuthorizationHeader(req.headers.authorization);
  const claims = jwt.verify(token, env.JWT_SECRET) as AccessTokenClaims;
  req.user = { id: claims.sub, email: claims.email };
  next();
};
```

Validate JWT từ `Authorization: Bearer <token>`. Gán `req.user` để các handler downstream sử dụng.

### 4.3 Proxy Services

Gateway dùng **axios** để forward request đến internal services, kèm header `X-Internal-Token`.

**`authProxyService`** → Auth Service (:4003)
| Method | Path | Mô tả |
|--------|------|--------|
| `register(payload)` | `POST /auth/register` | Đăng ký user |
| `login(payload)` | `POST /auth/login` | Đăng nhập |
| `refresh(payload)` | `POST /auth/refresh` | Refresh token |
| `revoke(payload)` | `POST /auth/revoke` | Revoke token |

**`chatProxyService`** → Chat Service (:4002)
| Method | Path | Mô tả |
|--------|------|--------|
| `createConversation(userId, payload)` | `POST /conversations` | Tạo conversation |
| `listConversations(userId)` | `GET /conversations` | Liệt kê conversation |
| `getConversation(id, userId)` | `GET /conversations/:id` | Lấy conversation |
| `createMessage(convId, userId, payload)` | `POST /conversations/:id/messages` | Gửi tin |
| `listMessages(convId, userId, query)` | `GET /conversations/:id/messages` | Lấy tin nhắn |

**`userProxyService`** → User Service (:4001)
| Method | Path | Mô tả |
|--------|------|--------|
| `getUserById(id)` | `GET /users/:id` | Lấy user |
| `getAllUsers()` | `GET /users` | Lấy tất cả users |
| `searchUsers(params)` | `GET /users/search` | Tìm kiếm user |

### 4.4 Lưu user ID qua header

```ts
// chat-proxy.service.ts
await client.post('/conversations', payload, {
  headers: { [USER_ID_HEADER]: userId }, // 'x-user-id'
});
```

Gateway truyền `userId` của authenticated user qua custom header `x-user-id` để các internal service biết ai đang thực hiện request.

---

## 5. Auth Service (Port 4003)

**Database:** MySQL 8.0 + Sequelize ORM

### 5.1 Models

#### `UserCredentials` (table: `user_credentials`)

| Column | Type | Ghi chú |
|--------|------|---------|
| `id` | UUID | PK, auto-generated |
| `email` | STRING | Unique, validated email |
| `displayName` | STRING | Min 3 chars |
| `passwordHash` | STRING | bcrypt hash |
| `createdAt` | DATE | Auto |
| `updatedAt` | DATE | Auto |

#### `RefreshToken` (table: `refresh_tokens`)

| Column | Type | Ghi chú |
|--------|------|---------|
| `id` | UUID | PK |
| `userId` | UUID | FK → UserCredentials |
| `tokenId` | UUID | Unique per token |
| `expiresAt` | DATE | TTL 30 ngày |

Relationship: `UserCredentials.hasMany(RefreshToken)` với `onDelete: CASCADE`.

### 5.2 `auth.service.ts` — Logic chính

#### `register(input)`

```
1. Kiểm tra email trùng → 409 nếu có
2. Transaction: tạo UserCredentials + RefreshToken
3. Sign accessToken (JWT) + refreshToken (JWT)
4. Publish event "auth.user.registered" lên RabbitMQ
5. Trả về { accessToken, refreshToken, user }
```

#### `login(input)`

```
1. Tìm user theo email → 401 nếu không thấy
2. bcrypt.compare password → 401 nếu sai
3. Tạo RefreshToken mới
4. Sign và trả về tokens
```

#### `refreshTokens(token)`

```
1. Verify refreshToken JWT → lấy payload.tokenId
2. Tìm RefreshToken trong DB theo tokenId + userId
3. Kiểm tra expiresAt → 401 nếu hết hạn
4. Xóa token cũ, tạo token mới (rotation)
5. Trả về tokens mới
```

#### `revokeRefreshToken(userId)`

Xóa toàn bộ RefreshToken của user → dùng khi logout.

### 5.3 Token Utilities (`utils/token.ts`)

```ts
// bcrypt với saltRounds = 12
export const hashPassword = async (password: string): Promise<string>
export const verifyPassword = async (password, hash): Promise<boolean>

// JWT signing
export const signAccessToken = (payload: { sub: string; email: string }): string
export const signRefreshToken = (payload: { sub: string; tokenId: string }): string
export const verifyRefreshToken = (token: string): RefreshTokenPayload
```

### 5.4 RabbitMQ Publisher (`messaging/event-publishing.ts`)

```ts
// Exchange: 'auth.events' (topic, durable)
// Routing key: 'auth.user.registered'
// Persistent: true

export const publishUserRegistered = (payload: AuthUserRegisteredPayload) => {
  channel.publish(AUTH_EVENT_EXCHANGE, AUTH_USER_REGISTERED_ROUTING_KEY, Buffer.from(...));
};
```

Publish fire-and-forget, có log warning nếu channel chưa sẵn sàng.

### 5.5 Zod Validation Schemas

```ts
registerSchema: { email: email(), password: min(8), displayName: min(3).max(30) }
loginSchema:    { email: email(), password: min(8) }
refreshSchema:  { refreshToken: string() }
revokeSchema:   { userId: uuid() }
```

---

## 6. User Service (Port 4001)

**Database:** PostgreSQL 16 + Sequelize ORM

### 6.1 `UserModel` (table: `users`)

| Column | Type | Ghi chú |
|--------|------|---------|
| `id` | UUID | PK |
| `email` | STRING | Unique |
| `displayName` | STRING | |
| `createdAt` | DATE | |
| `updatedAt` | DATE | |

### 6.2 `UserRepository`

| Method | Mô tả |
|--------|--------|
| `findById(id)` | Tìm theo PK |
| `findAll()` | Lấy tất cả, sort theo displayName ASC |
| `create(data)` | Tạo user mới |
| `searchByQuery(query, options)` | ILIKE search theo displayName hoặc email, hỗ trợ exclude IDs |
| `upsertFromAuthEvent(payload)` | Upsert từ RabbitMQ event |

### 6.3 `UserService`

```ts
class UserService {
  getUserById(id)          → User | 404
  getAllUsers()             → User[]
  createUser(input)        → User | 409 (duplicate)
  searchUsers(params)      → User[]
  syncFromAuthUser(payload) → User (upsert + publish UserCreated event)
}
```

### 6.4 RabbitMQ Consumer (`messaging/auth-consumer.ts`)

```
Exchange: 'auth.events' (topic)
Queue: 'auth-service.auth-events' (durable)
Binding: auth.user.registered

Khi nhận message:
  → parse JSON → AuthRegisteredEvent
  → userService.syncFromAuthUser(event.payload)
  → ch.ack(message) nếu thành công
  → ch.nack(message, false, false) nếu lỗi
```

User Service cũng publish event `user.created` sau khi sync — được define trong common nhưng chưa có consumer trong repo này (dự kiến cho Chat Service dùng sau).

---

## 7. Chat Service (Port 4002)

**Database:** MongoDB 7 (native driver)  
**Cache:** Redis 7 (ioredis)

### 7.1 Types

#### `Conversation`

```ts
interface Conversation {
  id: string;
  title: string | null;
  participantIds: string[];
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;  // 120 ký tự đầu của tin nhắn cuối
}
```

#### `Message`

```ts
interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: Date;
  reactions: Reaction[];  // { emoji, userId, createdAt }
}
```

### 7.2 MongoDB Collections

**Collection `conversations`:**
- `_id` dùng `randomUUID()` (string), không dùng ObjectId mặc định
- Index ngầm: `participantIds` (dùng trong `findSummaries`)
- Sort: `lastMessageAt desc, updatedAt desc`

**Collection `messages`:**
- `_id` dùng `randomUUID()` (string)
- Sort: `createdAt desc`
- Cursor-based pagination qua field `after` (timestamp)

### 7.3 `conversationRepository`

| Method | MongoDB query | Mô tả |
|--------|--------------|--------|
| `create(input)` | `insertOne` | Tạo conversation |
| `findById(id)` | `findOne({ _id: id })` | Tìm theo ID |
| `findSummaries(filter)` | `find({ participantIds: userId })` | Lấy danh sách |
| `touchConversation(id, preview)` | `updateOne → $set lastMessageAt, preview` | Cập nhật sau khi send message |

### 7.4 `messageRepository`

| Method | MongoDB query | Mô tả |
|--------|--------------|--------|
| `create(convId, senderId, body)` | `insertOne` | Tạo message |
| `findByConversation(convId, options)` | `find + sort createdAt desc + limit` | Lấy tin nhắn (có pagination) |
| `findById(id)` | `findOne` | Tìm theo ID |

**Pagination:**
```ts
// Cursor-based: lấy messages sau một thời điểm
if (options.after) {
  query.createdAt = { $gt: options.after };  // Date object
}
```

### 7.5 Redis Cache (`cache/conversation.cache.ts`)

```ts
const CACHE_PREFIX = 'conversation:';
const CACHE_TTL_SECONDS = 60;  // 1 phút

// Key pattern: "conversation:<id>"
// Serialize: JSON.stringify với Date → ISO string
// Deserialize: parse lại + new Date()

get(conversationId)   → Conversation | null
set(conversation)     → setex với TTL 60s
delete(conversationId) → del key
```

### 7.6 Redis Client (`clients/redis.client.ts`)

```ts
// Singleton pattern với ioredis
// lazyConnect: true — chỉ connect khi cần
// Events: error, connect, reconnect, close

export const getRedisClient = (): Redis => { ... }
export const connectRedis = async () => { ... }
export const closeRedis = async () => { await redis.quit(); redis = null; }
```

### 7.7 `conversationService` — Cache-aside pattern

```ts
async getConversationById(id) {
  const cached = await conversationCache.get(id);   // 1. Check cache
  if (cached) return cached;

  const conv = await conversationRepository.findById(id);  // 2. DB miss
  await conversationCache.set(conv);                // 3. Populate cache
  return conv;
}

async touchConversation(id, preview) {
  await conversationRepository.touchConversation(id, preview);
  await conversationCache.delete(id);               // Invalidate cache
}
```

### 7.8 `messageService`

```ts
async createMessage(conversationId, senderId, body) {
  // 1. Verify conversation tồn tại (qua conversationService — có caching)
  // 2. Verify sender là participant
  // 3. Insert message vào MongoDB
  // 4. touchConversation: update preview + invalidate cache
}

async listMessages(conversationId, requesterId, options) {
  // 1. Verify conversation + requester là participant
  // 2. Query messages với pagination
}
```

### 7.9 Middleware `authenticated-user.ts`

Chat Service đọc user từ header `x-user-id` (được Gateway truyền qua):

```ts
export const getAuthenticatedUser = (req: Request): AuthenticatedUser => {
  const userId = req.headers['x-user-id'];
  if (!userId) throw new HttpError(401, 'Unauthorized');
  return { id: userId as string };
};
```

---

## 8. Infrastructure (Docker Compose)

| Service | Image | Port | Volume |
|---------|-------|------|--------|
| `rabbitmq` | rabbitmq:3-management | 5672, 15672 | `rabbitmq-data` |
| `redis` | redis:7 | 6379 | `redis-data` |
| `mongo` | mongo:7 | 27017 | `mongo-data` |
| `user-db` | postgres:16 | 5432 | `user-db-data` |
| `auth-db` | mysql:8.0 | 3306 | `auth-db-data` |
| `gateway-service` | Build local | 4000 | — |
| `auth-service` | Build local | 4003 | — |
| `user-service` | Build local | 4001 | — |
| `chat-service` | Build local | 4002 | — |

**Health checks:** Tất cả services có healthcheck. Application services check `GET /health`. Infrastructure services check bằng native command (`rabbitmq-diagnostics ping`, `redis-cli ping`, `mongosh ping`, `pg_isready`, `mysqladmin ping`).

**Dependency order:**
```
auth-service → auth-db (healthy) + rabbitmq (healthy)
user-service → user-db (healthy) + rabbitmq (healthy)
chat-service → mongo (healthy) + redis (healthy) + rabbitmq (healthy)
gateway-service → auth-service (healthy) + user-service (healthy) + chat-service (healthy)
```

**Network:** Tất cả đều trong bridge network `chatapp-network`. Lưu ý: `gateway-service` đang comment phần `networks`, có thể là bug nhỏ trong repo.

---

## 9. API Reference

Base URL: `http://localhost:4000`

### Auth Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|--------|
| POST | `/auth/register` | Không | Đăng ký |
| POST | `/auth/login` | Không | Đăng nhập |
| POST | `/auth/refresh` | Không | Refresh token |
| POST | `/auth/revoke` | Internal | Revoke token |

### User Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|--------|
| GET | `/users` | Bearer | Lấy tất cả users |
| GET | `/users/:id` | Bearer | Lấy user theo ID |
| GET | `/users/search?query=&limit=&exclude=` | Bearer | Tìm kiếm user |

### Conversation & Message Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|--------|
| POST | `/conversations` | Bearer | Tạo conversation |
| GET | `/conversations` | Bearer | Liệt kê conversations |
| GET | `/conversations/:id` | Bearer | Lấy conversation |
| POST | `/conversations/:id/messages` | Bearer | Gửi tin nhắn |
| GET | `/conversations/:id/messages?limit=&after=` | Bearer | Lấy tin nhắn |

---

## 10. Patterns & Điểm đáng chú ý

### Pattern tốt

- **Database-per-service**: Mỗi service có DB riêng (MySQL, PostgreSQL, MongoDB) → loose coupling.
- **Internal token auth**: Các internal services được bảo vệ bằng `INTERNAL_API_TOKEN` header, tránh bị gọi trực tiếp từ ngoài.
- **Cache-aside**: Conversation cache với TTL 60s, invalidate đúng lúc khi có update.
- **Token rotation**: Refresh token bị xóa và tạo mới mỗi lần refresh → hạn chế replay attack.
- **Graceful shutdown**: Tất cả services xử lý `SIGINT`/`SIGTERM`, đóng DB connections và message queue sạch sẽ.
- **Event-driven sync**: User profile được sync tự động qua RabbitMQ, không cần gọi HTTP đồng bộ.

### Điểm cần lưu ý / cải thiện

- **Gateway network**: `gateway-service` trong docker-compose.yml đang comment phần `networks: chatapp-network` → có thể gây lỗi khi deploy toàn bộ stack bằng Docker.
- **Không có retry logic cho RabbitMQ**: Nếu RabbitMQ down sau khi service đã start, connection sẽ không tự reconnect.
- **Chat Service không validate user tồn tại**: Chỉ check `participantIds` có trong array, không verify ID thực sự tồn tại trong User Service.
- **`reactions` field**: Có type definition nhưng chưa có API để add/remove reaction.
- **`user.repository` trong chat-service**: Có file `/repositories/user.repository.ts` nhưng chưa rõ dùng để làm gì (có thể là cache user info).
- **Message sort desc**: Messages được trả về theo `createdAt desc` (mới nhất trước), cần client reverse lại để hiển thị đúng thứ tự.

---

## 11. Environment Variables

| Variable | Service dùng | Mô tả |
|----------|-------------|--------|
| `NODE_ENV` | All | `development` / `production` |
| `JWT_SECRET` | Gateway, Auth | Secret ký access token |
| `JWT_EXPIRES_IN` | Auth | Thời hạn access token (default: `1d`) |
| `JWT_REFRESH_SECRET` | Auth | Secret ký refresh token |
| `JWT_REFRESH_EXPIRES_IN` | Auth | Thời hạn refresh token (default: `30d`) |
| `INTERNAL_API_TOKEN` | All | Token bảo vệ internal endpoints |
| `AUTH_DB_URL` | Auth | MySQL connection string |
| `USER_DB_URL` | User | PostgreSQL connection string |
| `MONGO_URL` | Chat | MongoDB connection string |
| `REDIS_URL` | Chat | Redis connection string |
| `RABBITMQ_URL` | Auth, User, Chat | RabbitMQ connection string |
| `GATEWAY_PORT` | Gateway | Default: 4000 |
| `AUTH_SERVICE_PORT` | Auth | Default: 4003 |
| `USER_SERVICE_PORT` | User | Default: 4001 |
| `CHAT_SERVICE_PORT` | Chat | Default: 4002 |
