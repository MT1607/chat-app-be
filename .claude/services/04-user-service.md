# User Service — User Profile Management

> **Port:** 4001  
> **Vị trí:** `services/user-service/`  
> **Database:** PostgreSQL 16 (via Sequelize 6 + `pg` driver)  
> **Message Broker:** RabbitMQ (consumer từ Auth Service, publisher sang Chat Service)  
> **Dependencies chính:** `express ^5.1.0`, `sequelize ^6.37.7`, `pg`, `amqplib`

---

## Tổng quan

User Service quản lý **profile data** của người dùng (tách biệt hoàn toàn với credentials trong Auth Service). Service này:

- **Không tự đăng ký user** từ client — thay vào đó lắng nghe RabbitMQ event từ Auth Service
- **Cung cấp user lookup** và tìm kiếm cho Gateway và Chat Service
- **Publish event** `user.created` sau khi sync để Chat Service cũng có user cache

---

## Cấu trúc file

```
services/user-service/src/
├── index.ts                          ← Bootstrap
├── app.ts                            ← Express factory
├── config/
│   └── env.ts                        ← Env validation
├── db/
│   ├── index.ts                      ← Re-export sequelize + UserModel
│   ├── sequelize.ts                  ← PostgreSQL connection + sync
│   └── models/
│       └── user.model.ts             ← Sequelize UserModel
├── repositories/
│   └── user.repositories.ts          ← Data access layer
├── services/
│   └── user.service.ts               ← Business logic
├── controllers/
│   └── user.controller.ts            ← Route handlers
├── routes/
│   ├── index.ts                      ← Route registration
│   └── user.routes.ts                ← Route definitions
├── middleware/
│   └── error-handler.ts
├── messaging/
│   ├── auth-consumer.ts              ← RabbitMQ consumer (từ Auth Service)
│   └── event-publisher.ts            ← RabbitMQ publisher (sang Chat Service)
├── types/
│   └── user.ts                       ← TypeScript interfaces
├── validation/
│   └── user.schema.ts                ← Zod schemas
└── utils/
    └── logger.ts
```

---

## `index.ts` — Bootstrap

```ts
const main = async () => {
  await initializeDatabase();        // 1. PostgreSQL connect + sync
  await initMessaging();             // 2. RabbitMQ publisher channel
  await startAuthEventConsumer();    // 3. RabbitMQ consumer (lắng nghe Auth events)

  const app = createApp();
  const server = createServer(app);

  server.listen(env.USER_SERVICE_PORT, () => {
    logger.info({ port }, 'User service is running');
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};
```

**Lưu ý:** Graceful shutdown trong User Service chưa close DB và RabbitMQ (`Promise.all([])` rỗng). Đây là một thiếu sót nhỏ so với Auth Service.

---

## `app.ts` — Express Factory

```ts
export const createApp = (): Application => {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Protect tất cả routes (trừ /health) bằng internal token
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

---

## `config/env.ts`

```ts
const envSchema = z.object({
  NODE_ENV:           z.enum(['development', 'production', 'test']).default('development'),
  USER_SERVICE_PORT:  z.coerce.number().int().min(0).max(65_535).default(4001),
  USER_DB_URL:        z.string(),
  RABBITMQ_URL:       z.string().optional(),   // Optional: có thể chạy không có MQ
  INTERNAL_API_TOKEN: z.string().min(16),
});
```

`RABBITMQ_URL` là optional — service vẫn start được khi không có RabbitMQ (messaging bị disable, không publish/consume events).

---

## Database Layer

### `db/sequelize.ts` — PostgreSQL Connection

```ts
export const sequelize = new Sequelize(env.USER_DB_URL, {
  dialect: 'postgres',
  logging: env.NODE_ENV === 'development'
    ? (msg: unknown) => logger.debug({ sequelize: msg })
    : false,
  define: {
    underscored: true,      // camelCase → snake_case columns
    freezeTableName: true,  // không tự thêm 's'
  },
});

export const initializeDatabase = async () => {
  await connectToDatabase();   // sequelize.authenticate()

  // Dev: sync strict (không alter), Prod: alter (thêm columns mới nếu cần)
  const syncOptions = env.NODE_ENV === 'development' ? {} : { alter: true };
  await sequelize.sync(syncOptions);
};
```

**Khác với Auth Service:** User Service dùng `{ alter: true }` trong production → Sequelize tự thêm/sửa columns nếu model thay đổi. Auth Service chỉ dùng `sync()` không có options.

### `db/models/user.model.ts`

**Table:** `users`

```ts
export type UserCreationAttributes = Optional<User, 'id' | 'createdAt' | 'updatedAt'>;

export class UserModel extends Model<User, UserCreationAttributes> implements User {
  declare id: string;
  declare email: string;
  declare displayName: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

UserModel.init({
  id: {
    type: DataTypes.UUID,
    allowNull: false,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { isEmail: true },
  },
  displayName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // createdAt, updatedAt: auto-managed
}, { sequelize, tableName: 'users' });
```

**UUID đồng nhất với Auth Service:** `id` trong `users` (PostgreSQL) là cùng UUID với `id` trong `user_credentials` (MySQL) — được sync qua RabbitMQ event.

---

## `types/user.ts`

```ts
export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
}
```

User Service không store password — chỉ profile data công khai.

---

## `repositories/user.repositories.ts` — Data Access Layer

```ts
// Domain mapping: Sequelize model → pure domain object
const toDomainUser = (model: UserModel): User => ({
  id: model.id,
  email: model.email,
  displayName: model.displayName,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});
```

### `findById(id: string): Promise<User | null>`

```ts
async findById(id: string): Promise<User | null> {
  const user = await UserModel.findByPk(id);
  return user ? toDomainUser(user) : null;
}
```

### `findAll(): Promise<User[]>`

```ts
async findAll(): Promise<User[]> {
  const users = await UserModel.findAll({
    order: [['displayName', 'ASC']],
  });
  return users.map(toDomainUser);
}
```

### `create(data: CreateUserInput): Promise<User>`

```ts
async create(data: CreateUserInput): Promise<User> {
  const user = await UserModel.create(data);
  return toDomainUser(user);
}
```

### `searchByQuery(query, options): Promise<User[]>`

```ts
async searchByQuery(
  query: string,
  options: { limit?: number; excludeIds?: string[] } = {},
): Promise<User[]> {
  const where: WhereOptions = {
    [Op.or]: [
      { displayName: { [Op.iLike]: `%${query}%` } },  // case-insensitive LIKE (PostgreSQL)
      { email:       { [Op.iLike]: `%${query}%` } },
    ],
  };

  if (options.excludeIds && options.excludeIds.length > 0) {
    Object.assign(where, {
      [Op.and]: [{ id: { [Op.notIn]: options.excludeIds } }],
    });
  }

  const users = await UserModel.findAll({
    where,
    order: [['displayName', 'ASC']],
    limit: options.limit ?? 10,
  });

  return users.map(toDomainUser);
}
```

`Op.iLike` là PostgreSQL-specific — case-insensitive LIKE. Không hoạt động với MySQL. Đây là lý do User Service dùng PostgreSQL thay vì MySQL.

**Query được generate:**
```sql
SELECT * FROM users
WHERE (display_name ILIKE '%john%' OR email ILIKE '%john%')
AND id NOT IN ('uuid1', 'uuid2')
ORDER BY display_name ASC
LIMIT 10;
```

### `upsertFromAuthEvent(payload): Promise<User>`

```ts
async upsertFromAuthEvent(payload: AuthUserRegisteredPayload): Promise<User> {
  const [user] = await UserModel.upsert(
    {
      id:          payload.id,
      email:       payload.email,
      displayName: payload.displayName,
      createdAt:   new Date(payload.createdAt),
      updatedAt:   new Date(payload.createdAt),  // dùng createdAt cho cả updatedAt
    },
    { returning: true },   // trả về record sau upsert
  );

  return toDomainUser(user);
}
```

`Sequelize.upsert()` = `INSERT ... ON CONFLICT DO UPDATE` trong PostgreSQL. Nếu user đã tồn tại (duplicate event) → update, không throw error.

---

## `services/user.service.ts` — Business Logic

```ts
class UserService {
  constructor(private readonly repository: UserRepository) {}
  // ...
}

export const userService = new UserService(userRepository);
```

Dùng class với dependency injection để dễ test.

### `getUserById(id: string): Promise<User>`

```ts
async getUserById(id: string): Promise<User> {
  const user = await this.repository.findById(id);
  if (!user) throw new HttpError(404, 'User not found');
  return user;
}
```

### `getAllUsers(): Promise<User[]>`

```ts
async getAllUsers(): Promise<User[]> {
  return this.repository.findAll();
}
```

Không có pagination — có thể là vấn đề nếu users tăng nhiều.

### `createUser(input: CreateUserInput): Promise<User>`

```ts
async createUser(input: CreateUserInput): Promise<User> {
  try {
    const user = await this.repository.create(input);

    // Publish sang Chat Service (fire-and-forget)
    void publishUserCreatedEvent({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    });

    return user;
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw new HttpError(409, 'User already exists');
    }
    throw error;
  }
}
```

### `searchUsers(params): Promise<User[]>`

```ts
async searchUsers(params: { query: string; limit?: number; excludeIds?: string[] }): Promise<User[]> {
  const query = params.query.trim();
  if (query.length === 0) return [];   // Guard: empty query → empty result

  return this.repository.searchByQuery(query, {
    limit: params.limit,
    excludeIds: params.excludeIds,
  });
}
```

### `syncFromAuthUser(payload: AuthUserRegisteredPayload): Promise<User>`

```ts
async syncFromAuthUser(payload: AuthUserRegisteredPayload): Promise<User> {
  const user = await this.repository.upsertFromAuthEvent(payload);

  // Publish user.created event để Chat Service cache user info
  void publishUserCreatedEvent({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  });

  return user;
}
```

Đây là method chính được gọi từ RabbitMQ consumer.

---

## `controllers/user.controller.ts`

```ts
export const getUser: AsyncHandler = async (req, res, next) => {
  try {
    const { id } = req.params as unknown as UserIdParams;
    const user = await userService.getUserById(id);
    res.json({ data: user });
  } catch (error) { next(error); }
};

export const getAllUsers: AsyncHandler = async (req, res, next) => {
  try {
    const users = await userService.getAllUsers();
    res.json({ data: users });
  } catch (error) { next(error); }
};

export const createUser: AsyncHandler = async (req, res, next) => {
  try {
    const payload = req.body as CreateUserBody;
    const user = await userService.createUser(payload);
    res.status(201).json({ data: user });
  } catch (error) { next(error); }
};

export const searchUsers: AsyncHandler = async (req, res, next) => {
  try {
    const { query, limit, exclude } = req.query as unknown as SearchUsersQuery;
    const user = await userService.searchUsers({
      query,
      limit,
      excludeIds: exclude,
    });
    res.json({ data: user });
  } catch (error) { next(error); }
};
```

---

## Routes

```ts
// user.routes.ts
userRoutes.get('/',        asyncHandler(getAllUsers));
userRoutes.get('/search',  validateRequest({ query: searchUsersQuerySchema }), asyncHandler(searchUsers));
userRoutes.get('/:id',     validateRequest({ params: userIdParamsSchema }), asyncHandler(getUser));
userRoutes.post('/',       validateRequest({ body: createUserSchema }), asyncHandler(createUser));
```

**Order quan trọng:** `/search` phải đứng trước `/:id`, nếu không Express sẽ hiểu `/search` là một ID parameter.

---

## `validation/user.schema.ts`

```ts
export const createUserSchema = z.object({
  email:       z.string().email(),
  displayName: z.string().min(3).max(255),
});

export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// Hỗ trợ cả 2 format: ?exclude=id1&exclude=id2 (array) hoặc ?exclude=id1 (single)
const excludeSchema = z.union([
  z.array(z.string().uuid()),
  z.string().uuid()
    .transform((value) => [value])    // "uuid" → ["uuid"]
    .optional()
    .transform((value) => value ?? []),
]);

export const searchUsersQuerySchema = z.object({
  query:   z.string().trim().min(3).max(255),
  limit:   z.union([z.string(), z.number()])
    .transform((value) => Number())   // ⚠️ Bug giống Gateway: Number() thay vì Number(value)
    .refine((value) => Number.isInteger(value) && value > 0 && value <= 25)
    .optional(),
  exclude: excludeSchema,
});
```

> ⚠️ **Bug:** Cùng bug `Number()` như Gateway Service — `limit` luôn về `0`, fail refine, bị ignore (vì `.optional()`). Kết quả là `limit` trong search query luôn dùng default `10` từ repository.

---

## `messaging/auth-consumer.ts` — RabbitMQ Consumer

Consumer lắng nghe event từ Auth Service khi có user đăng ký mới.

```ts
const QUEUE_NAME = 'auth-service.auth-events';

export const startAuthEventConsumer = async () => {
  if (!env.RABBITMQ_URL) {
    logger.warn('RabbitMQ URL is not configured, skip');
    return;
  }

  const connection = (await connect(env.RABBITMQ_URL)) as ManageConnection;
  const ch = await connection.createChannel();

  // Declare exchange (phải match với Auth Service publisher)
  await ch.assertExchange(AUTH_EVENT_EXCHANGE, 'topic', { durable: true });

  // Queue riêng của User Service
  const queue = await ch.assertQueue(QUEUE_NAME, { durable: true });

  // Bind queue với routing key
  await ch.bindQueue(queue.queue, AUTH_EVENT_EXCHANGE, AUTH_USER_REGISTERED_ROUTING_KEY);
  // = bind 'auth-service.auth-events' → 'auth.events' exchange → key 'auth.user.registered'
```

### Message handler

```ts
const handleMessage = async (message: ConsumeMessage, ch: Channel) => {
  const raw = message.content.toString('utf-8');
  const event = JSON.parse(raw) as AuthRegisteredEvent;

  await userService.syncFromAuthUser(event.payload);  // upsert vào PostgreSQL

  ch.ack(message);   // Báo RabbitMQ đã xử lý thành công
};
```

### Error handling

```ts
const consumeHandler = (msg: ConsumeMessage | null) => {
  if (!msg) return;

  void handleMessage(msg, ch).catch((error: unknown) => {
    logger.error({ err: error }, 'Failed to process auth event');
    ch.nack(msg, false, false);   // nack(msg, allUpTo=false, requeue=false)
    // requeue=false: không requeue → message bị drop (không vào dead letter queue)
  });
};
```

> ⚠️ `requeue: false` — message lỗi bị drop hoàn toàn. Production nên config Dead Letter Exchange (DLX) để không mất message.

### Graceful stop

```ts
export const stopAuthEventConsume = async () => {
  if (ch && consumerTag) {
    await ch.cancel(consumerTag);   // Stop nhận messages mới
  }
  if (ch) await ch.close();
  if (conn) await closeConnection(conn);
};
```

---

## `messaging/event-publisher.ts` — RabbitMQ Publisher

Publisher sang Chat Service với exchange `user.events`.

```ts
type ManagedConnection = Connection & Pick<ChannelModel, 'close' | 'createChannel'>;

const messagingEnabled = Boolean(env.RABBITMQ_URL);

// Lazy initialization: channel chỉ được tạo khi cần publish
const ensureChannel = async (): Promise<Channel | null> => {
  if (!messagingEnabled) return null;
  if (channel) return channel;

  const amqpConnection = await amqplib.connect(env.RABBITMQ_URL);
  // ...setup channel, exchange...
  return channel;
};
```

```ts
export const publishUserCreatedEvent = async (payload: UserCreatedPayload) => {
  const ch = await ensureChannel();
  if (!ch) {
    logger.debug({ payload }, 'Skipping user.created event; messaging disabled');
    return;
  }

  const event: UserCreatedEvent = {
    type:       USER_CREATED_ROUTING_KEY,   // 'user.created'
    payload,
    occurredAt: new Date().toISOString(),
    metadata:   { version: 1 },
  };

  try {
    const sucess = ch.publish(  // ⚠️ Typo: "sucess" thay vì "success"
      USER_EVENTS_EXCHANGE,     // 'user.events'
      USER_CREATED_ROUTING_KEY,
      Buffer.from(JSON.stringify(event)),
      { contentType: 'application/json', persistent: true },
    );

    if (!sucess) {
      logger.warn({ event }, 'Failed to publish user.created event');
    }
  } catch (error) {
    logger.error({ err: error }, 'Error publishing user.created event');
  }
};
```

---

## Event Flow hoàn chỉnh

```
[Client] POST /auth/register
    ↓
[Gateway] forward → Auth Service
    ↓
[Auth Service] Tạo UserCredentials trong MySQL
    ↓ publish
[RabbitMQ] Exchange: auth.events
    Routing key: auth.user.registered
    ↓ consume
[User Service] auth-consumer.ts
    ↓ userService.syncFromAuthUser()
    ↓ repository.upsertFromAuthEvent()
[PostgreSQL] Upsert vào table 'users'
    ↓ publish
[RabbitMQ] Exchange: user.events
    Routing key: user.created
    ↓ consume
[Chat Service] rabbitmq.consumer.ts
    ↓ userRepository.upsertUser()
[MongoDB] Upsert vào collection 'users'
```

---

## Tóm tắt Design Decisions

| Quyết định | Lý do |
|-----------|-------|
| PostgreSQL thay vì MySQL | `Op.iLike` cho case-insensitive search — MySQL không có ILIKE native |
| `upsert` thay vì `create` | RabbitMQ event có thể duplicate → idempotent operation |
| Class-based UserService | Dễ mock trong unit test (inject mock repository) |
| RABBITMQ_URL optional | Service có thể chạy standalone mà không cần message broker |
| Tách publisher/consumer | Publisher sang Chat Service, Consumer từ Auth Service → SRP |
