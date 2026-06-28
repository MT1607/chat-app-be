# Auth Service — Authentication & Authorization

> **Port:** 4003  
> **Vị trí:** `services/auth-service/`  
> **Database:** MySQL 8.0 (via Sequelize 6)  
> **Message Broker:** RabbitMQ (publisher)  
> **Dependencies chính:** `express ^5.1.0`, `sequelize ^6.37.7`, `mysql2`, `jsonwebtoken`, `bcrypt`, `amqplib`

---

## Tổng quan

Auth Service quản lý toàn bộ vòng đời xác thực người dùng:

- **Đăng ký:** hash password, tạo user trong DB, sign JWT, publish RabbitMQ event
- **Đăng nhập:** verify credentials, sign JWT mới
- **Refresh token:** rotate token (xóa cũ, tạo mới)
- **Revoke token:** logout, xóa refresh token

Service này là **internal** — chỉ được gọi từ Gateway qua `X-Internal-Token` header. Client không gọi trực tiếp.

---

## Cấu trúc file

```
services/auth-service/src/
├── index.ts                          ← Bootstrap
├── app.ts                            ← Express factory
├── config/
│   └── env.ts                        ← Env validation
├── db/
│   └── sequelize.ts                  ← MySQL connection
├── models/
│   ├── index.ts                      ← Model registration + sync
│   ├── user-credentials.model.ts     ← Sequelize UserCredentials model
│   └── refresh-token.model.ts        ← Sequelize RefreshToken model
├── services/
│   └── auth.service.ts               ← Business logic
├── controllers/
│   └── auth.controller.ts            ← Route handlers
├── routes/
│   ├── index.ts                      ← Route registration
│   ├── auth.routes.ts                ← Route definitions
│   └── auth.schema.ts                ← Zod schemas
├── middleware/
│   └── error-handler.ts
├── messaging/
│   └── event-publishing.ts           ← RabbitMQ publisher
├── types/
│   └── auth.ts                       ← TypeScript interfaces
└── utils/
    ├── logger.ts
    └── token.ts                      ← JWT + bcrypt utilities
```

---

## `index.ts` — Bootstrap

```ts
const main = async () => {
  await connectToDatabase();   // 1. MySQL connection
  await initModels();          // 2. Sequelize.sync() → tạo tables nếu chưa có
  await initPublisher();       // 3. RabbitMQ channel

  const app = createApp();
  const server = createServer(app);

  server.listen(env.AUTH_SERVICE_PORT, () => {
    logger.info({ port }, 'Auth service is running');
  });

  const shutdown = () => {
    Promise.all([closeDatabase(), closePublisher()])
      .finally(() => server.close(() => process.exit(0)));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};
```

**Thứ tự startup quan trọng:** DB → Models → RabbitMQ → HTTP server. Nếu bất kỳ bước nào fail → `process.exit(1)`.

---

## `app.ts` — Express Factory

```ts
export const createApp = (): Application => {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Bảo vệ tất cả routes ngoại trừ /health
  app.use(
    createInternalAuthMiddleware(env.INTERNAL_API_TOKEN, {
      exemptPaths: ['/health'],
    }),
  );

  registerRoutes(app);

  app.use((_req, res) => res.status(404).json({ message: 'Not Found' }));
  app.use(errorHandler);

  return app;
};
```

Internal auth middleware được mount **global** (trước `registerRoutes`) nên bảo vệ toàn bộ endpoints trừ `/health`.

---

## `config/env.ts` — Environment Config

```ts
const envSchema = z.object({
  NODE_ENV:                 z.enum(['development', 'production', 'test']).default('development'),
  AUTH_SERVICE_PORT:        z.coerce.number().int().min(0).max(65_535).default(4003),
  AUTH_DB_URL:              z.string(),             // MySQL connection URL
  JWT_SECRET:               z.string().min(32),
  JWT_EXPIRES_IN:           z.string().default('1d'),
  JWT_REFRESH_SECRET:       z.string().min(32),
  JWT_REFRESH_EXPIRES_IN:   z.string().default('30d'),
  RABBITMQ_URL:             z.string(),
  INTERNAL_API_TOKEN:       z.string().min(32),     // ≥ 32 chars (stricter hơn Gateway)
});
```

---

## Database Layer

### `db/sequelize.ts` — MySQL Connection

```ts
export const sequelize = new Sequelize(env.AUTH_DB_URL, {
  dialect: 'mysql',
  logging: env.NODE_ENV === 'development'
    ? (msg: unknown) => logger.debug({ sequelize: msg })
    : false,
  define: {
    underscored: true,       // column names dùng snake_case thay vì camelCase
    freezeTableName: true,   // Sequelize không tự thêm 's' vào table name
  },
});

export const connectToDatabase = async () => {
  await sequelize.authenticate();
};

export const closeDatabase = async () => {
  await sequelize.close();
};
```

`underscored: true` → `passwordHash` trong model → `password_hash` trong DB column.

### `models/index.ts` — Model Sync

```ts
export const initModels = async () => {
  await sequelize.sync();  // CREATE TABLE IF NOT EXISTS
};

export { UserCredentials, RefreshToken };
```

`sequelize.sync()` (không có `{ force: true }`) chỉ tạo table mới, không drop table cũ → safe cho production.

---

## Models

### `models/user-credentials.model.ts`

**Table:** `user_credentials`

```ts
export interface UserCredentialsAttributes {
  id: string;           // UUID v4, auto-generated
  email: string;        // unique, validated format
  displayName: string;
  passwordHash: string; // bcrypt hash, KHÔNG phải plain password
  createdAt: Date;
  updatedAt: Date;
}
```

**Sequelize definition:**

```ts
UserCredentials.init({
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,   // auto-generate UUID
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { isEmail: true },       // Sequelize-level email validation
  },
  passwordHash: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  displayName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // createdAt, updatedAt: managed by Sequelize
}, {
  sequelize,
  tableName: 'user_credentials',
});
```

### `models/refresh-token.model.ts`

**Table:** `refresh_tokens`

```ts
export interface RefreshTokenAttributes {
  id: string;       // UUID, PK
  userId: string;   // FK → user_credentials.id
  tokenId: string;  // UUID, unique per token (không phải JWT itself)
  expiresAt: Date;  // TTL: 30 ngày từ lúc tạo
  createdAt: Date;
  updatedAt: Date;
}
```

**Associations:**

```ts
// CASCADE: xóa user → tự xóa hết refresh tokens
UserCredentials.hasMany(RefreshToken, {
  foreignKey: 'userId',
  as: 'refreshTokens',
  onDelete: 'CASCADE',
});

RefreshToken.belongsTo(UserCredentials, {
  foreignKey: 'userId',
  as: 'user',
});
```

---

## `utils/token.ts` — JWT & Bcrypt Utilities

```ts
const ACCESS_TOKEN: Secret  = env.JWT_SECRET;
const REFRESH_TOKEN: Secret = env.JWT_REFRESH_SECRET;
```

### Password hashing

```ts
export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
};

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};
```

`saltRounds = 12` là mức bảo mật cao — chậm hơn default (10) nhưng khó brute-force hơn (~300ms/hash).

### JWT Payloads

```ts
export interface AccessTokenPayload {
  sub: string;    // userId
  email: string;
}

export interface RefreshTokenPayload {
  sub: string;      // userId
  tokenId: string;  // UUID của RefreshToken record trong DB
}
```

**Tại sao refreshToken có `tokenId`?**  
Để có thể revoke specific token. Khi refresh, server lookup `tokenId` trong DB — nếu không tìm thấy (đã bị revoke hoặc đã dùng rồi) → từ chối.

### JWT signing/verifying

```ts
export const signAccessToken  = (payload: AccessTokenPayload):  string =>
  jwt.sign(payload, ACCESS_TOKEN,  { expiresIn: env.JWT_EXPIRES_IN as ... });

export const signRefreshToken = (payload: RefreshTokenPayload): string =>
  jwt.sign(payload, REFRESH_TOKEN, { expiresIn: env.JWT_REFRESH_EXPIRES_IN as ... });

// Chỉ verify refresh token (access token được verify bởi Gateway)
export const verifyRefreshToken = (token: string): RefreshTokenPayload =>
  jwt.verify(token, REFRESH_TOKEN) as RefreshTokenPayload;
```

---

## `services/auth.service.ts` — Business Logic

### `register(input: RegisterInput): Promise<AuthResponse>`

```ts
export const register = async (input: RegisterInput): Promise<AuthResponse> => {
  // 1. Check email trùng
  const existing = await UserCredentials.findOne({
    where: { email: { [Op.eq]: input.email } },
  });
  if (existing) throw new HttpError(409, 'User with this email already exists');

  // 2. Transaction: tạo user + refresh token cùng lúc
  const transaction = await sequelize.transaction();
  try {
    const passwordHash = await hashPassword(input.password);
    const user = await UserCredentials.create(
      { email, displayName, passwordHash },
      { transaction },
    );

    const refreshTokenRecord = await createRefreshToken(user.id, transaction);

    await transaction.commit();

    // 3. Sign tokens
    const accessToken  = signAccessToken({ sub: user.id, email: user.email });
    const refreshToken = signRefreshToken({ sub: user.id, tokenId: refreshTokenRecord.tokenId });

    const userData = { id, email, displayName, createdAt: user.createdAt.toISOString() };

    // 4. Publish event (fire-and-forget, không await)
    publishUserRegistered(userData);

    return { accessToken, refreshToken, user: userData };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
```

**Tại sao dùng transaction?** Nếu tạo `UserCredentials` thành công nhưng tạo `RefreshToken` fail → transaction rollback, không để lại user orphan.

### `login(input: LoginInput): Promise<AuthTokens>`

```ts
export const login = async (input: LoginInput): Promise<AuthTokens> => {
  const credential = await UserCredentials.findOne({
    where: { email: { [Op.eq]: input.email } },
  });
  if (!credential) throw new HttpError(401, 'Invalid credentials');

  const valid = await verifyPassword(input.password, credential.passwordHash);
  if (!valid) throw new HttpError(401, 'Invalid credentials');
  // ⚠️ Cùng error message cho cả "không tìm thấy" và "sai password"
  // → Tránh user enumeration attack

  const refreshTokenRecord = await createRefreshToken(credential.id);
  const accessToken  = signAccessToken({ sub: credential.id, email: credential.email });
  const refreshToken = signRefreshToken({ sub: credential.id, tokenId: refreshTokenRecord.tokenId });

  return { accessToken, refreshToken };
};
```

### `refreshTokens(token: string): Promise<AuthTokens>`

```ts
export const refreshTokens = async (token: string): Promise<AuthTokens> => {
  // 1. Verify JWT (expired → throw)
  const payload = verifyRefreshToken(token);

  // 2. Lookup tokenId trong DB
  const tokenRecord = await RefreshToken.findOne({
    where: { tokenId: payload.tokenId, userId: payload.sub },
  });
  if (!tokenRecord) throw new HttpError(401, 'Invalid refresh token');

  // 3. Check TTL bằng DB (double-check, JWT đã check rồi)
  if (tokenRecord.expiresAt.getTime() < Date.now()) {
    await tokenRecord.destroy();
    throw new HttpError(401, 'Refresh token has expired');
  }

  // 4. Verify user vẫn tồn tại
  const credential = await UserCredentials.findByPk(payload.sub);
  if (!credential) {
    logger.warn({ userId: payload.sub }, 'User missing for refresh token');
    throw new HttpError(401, 'Invalid refresh token');
  }

  // 5. Token rotation: xóa cũ, tạo mới
  await tokenRecord.destroy();
  const newTokenRecord = await createRefreshToken(credential.id);

  return {
    accessToken:  signAccessToken({ sub: credential.id, email: credential.email }),
    refreshToken: signRefreshToken({ sub: credential.id, tokenId: newTokenRecord.tokenId }),
  };
};
```

**Token rotation** là pattern bảo mật tốt: mỗi lần refresh, token cũ bị vô hiệu hóa. Nếu attacker steal được refresh token và dùng trước user → user dùng token cũ sẽ bị 401 → biết token bị đánh cắp.

### `revokeRefreshToken(userId: string): Promise<void>`

```ts
export const revokeRefreshToken = async (userId: string) => {
  await RefreshToken.destroy({ where: { userId } });
};
```

Xóa **tất cả** refresh tokens của user → logout khỏi mọi thiết bị.

### `createRefreshToken(userId, transaction?)` — Private helper

```ts
const createRefreshToken = async (userId: string, transaction?: Transaction) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);   // 30 ngày TTL

  const tokenId = crypto.randomUUID();

  return RefreshToken.create({ userId, tokenId, expiresAt }, { transaction });
};
```

`tokenId` là UUID ngẫu nhiên — đây là "ID" của token record, khác với `id` (primary key). Được nhúng vào JWT payload để server có thể lookup.

---

## `controllers/auth.controller.ts`

```ts
export const registerHandler: RequestHandler = asyncHandler(async (req, res) => {
  const payload = req.body as RegisterInput;   // đã validated bởi middleware
  const tokens = await register(payload);
  res.status(201).json(tokens);
});

export const loginHandler: RequestHandler = asyncHandler(async (req, res) => {
  const payload = req.body as LoginInput;
  const tokens = await login(payload);
  res.json(tokens);
});

export const refreshHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) throw new HttpError(400, 'refreshToken is required');
  const tokens = await refreshTokens(refreshToken);
  res.json(tokens);
});

export const revokeHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) throw new HttpError(400, 'userId is required');
  await revokeRefreshToken(userId);
  res.status(204).send();
});
```

---

## `routes/auth.routes.ts` và `auth.schema.ts`

```ts
// Routes
authRouter.post('/register', validateRequest({ body: registerSchema.shape.body }), registerHandler);
authRouter.post('/login',    validateRequest({ body: loginSchema.shape.body }),    loginHandler);
authRouter.post('/refresh',  validateRequest({ body: refreshSchema.shape.body }),  refreshHandler);
authRouter.post('/revoke',   validateRequest({ body: revokeSchema.shape.body }),   revokeHandler);
```

**Lưu ý:** Auth Service dùng `.shape.body` (nested schema `z.object({ body: z.object({...}) })`), khác với Gateway dùng flat schema. Cách này hơi khác nhau giữa 2 service — có thể được refactor để thống nhất.

```ts
// Schemas (auth-service version — nested)
export const registerSchema = z.object({
  body: z.object({
    email:       z.string().email(),
    password:    z.string().min(8),
    displayName: z.string().min(3).max(30),
  }),
});
```

---

## `messaging/event-publishing.ts` — RabbitMQ Publisher

```ts
let connectionRef: ChannelModel | null = null;
let channel: Channel | null = null;

export const initPublisher = async () => {
  if (!env.RABBITMQ_URL) {
    logger.warn('RABBITMQ_URL not defined. Skipping RabbitMQ init.');
    return;
  }

  const connection = await connect(env.RABBITMQ_URL);
  connectionRef = connection;
  channel = await connection.createChannel();

  // Exchange: 'auth.events', type: topic, durable (survive broker restart)
  await channel.assertExchange(AUTH_EVENT_EXCHANGE, 'topic', { durable: true });

  connection.on('close', () => {
    logger.warn('RabbitMQ connection closed');
    channel = null;
    connectionRef = null;
  });
  connection.on('error', (err) => {
    logger.error({ err }, 'RabbitMQ connection error');
  });
};
```

### `publishUserRegistered(payload)`

```ts
export const publishUserRegistered = (payload: AuthUserRegisteredPayload) => {
  if (!channel) {
    logger.warn('RabbitMQ channel not initialized. Cannot publish.');
    return;   // fire-and-forget: không throw error nếu channel unavailable
  }

  const event = {
    type:       AUTH_USER_REGISTERED_ROUTING_KEY,  // 'auth.user.registered'
    payload,
    occuredAt:  new Date().toISOString(),           // ⚠️ Typo: "occured" thay vì "occurred"
    metadata:   { version: 1 },
  };

  const published = channel.publish(
    AUTH_EVENT_EXCHANGE,                          // exchange: 'auth.events'
    AUTH_USER_REGISTERED_ROUTING_KEY,             // routing key
    Buffer.from(JSON.stringify(event)),
    { contentType: 'application/json', persistent: true },  // persistent: survive queue restart
  );

  if (!published) {
    logger.warn({ event }, 'Failed to publish user registered event');
  }
};
```

> ⚠️ **Typo:** `occuredAt` thay vì `occurredAt` — Consumer (User Service) parse trực tiếp nên không ảnh hưởng runtime, nhưng khác với `OutboundEvent` interface trong common (`occurredAt`).

### `closePublisher()`

```ts
export const closePublisher = async () => {
  const ch = channel;
  if (ch) { await ch.close(); channel = null; }
  const conn = connectionRef;
  if (conn) { await conn.close(); connectionRef = null; }
};
```

Graceful close: đóng channel trước, rồi mới đóng connection.

---

## `types/auth.ts`

```ts
export interface RegisterInput  { email: string; password: string; displayName: string; }
export interface LoginInput     { email: string; password: string; }

export interface UserData {
  id: string; email: string; displayName: string; createdAt: string;
}

export interface AuthTokens   { accessToken: string; refreshToken: string; }
export interface AuthResponse extends AuthTokens { user: UserData; }
```

`register` trả về `AuthResponse` (có user data), `login` và `refresh` trả về `AuthTokens` (chỉ tokens).

---

## Luồng hoàn chỉnh: Register

```
Gateway POST /auth/register
  ↓ validateRequest (Zod)
  ↓ asyncHandler(registerUser)
  ↓ authProxyService.register(payload)
      ↓ axios.post('http://auth-service:4003/auth/register', payload, {
            headers: { 'X-Internal-Token': '...' }
          })
  ↓ Auth Service: createInternalAuthMiddleware (check X-Internal-Token)
  ↓ Auth Service: validateRequest({ body: registerSchema.shape.body })
  ↓ Auth Service: registerHandler
      ↓ register(payload)
          ↓ findOne email → 409 nếu trùng
          ↓ transaction.begin()
          ↓ hashPassword (bcrypt, 12 rounds)
          ↓ UserCredentials.create()
          ↓ createRefreshToken() (crypto.randomUUID)
          ↓ transaction.commit()
          ↓ signAccessToken (JWT, 1 ngày)
          ↓ signRefreshToken (JWT, 30 ngày)
          ↓ publishUserRegistered() → RabbitMQ 'auth.events'
          ↓ return { accessToken, refreshToken, user }
  ↓ res.status(201).json(tokens)
```

---

## Security Notes

| Vấn đề | Implementation |
|--------|---------------|
| Password storage | bcrypt với 12 rounds — không bao giờ store plain text |
| User enumeration | Login trả cùng error cho "không tìm thấy" và "sai password" |
| Token leakage | 5xx errors ẩn message thật (chỉ trả "Internal Server Error") |
| Token replay | Refresh token rotation — token cũ bị invalidate sau mỗi lần dùng |
| Token revoke | `revokeRefreshToken(userId)` xóa tất cả tokens (logout all devices) |
| Internal access | `X-Internal-Token` header bảo vệ khỏi direct external access |
| JWT separate keys | Access token và refresh token dùng 2 secret keys khác nhau |
