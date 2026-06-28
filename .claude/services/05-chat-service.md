# Chat Service — Messaging & Conversations

> **Port:** 4002  
> **Vị trí:** `services/chat-service/`  
> **Database:** MongoDB 7 (native driver `mongodb@^7`)  
> **Cache:** Redis 7 (ioredis `^5.8.2`)  
> **Message Broker:** RabbitMQ (consumer từ User Service)  
> **Dependencies chính:** `express ^5.1.0`, `mongodb`, `ioredis`, `amqplib`, `jsonwebtoken`, `socket.io` (có trong package.json nhưng chưa implement)

---

## Tổng quan

Chat Service là service phức tạp nhất trong hệ thống — xử lý toàn bộ logic nhắn tin:

- **Conversation management:** tạo, liệt kê, lấy chi tiết conversation
- **Message management:** gửi tin, lấy lịch sử tin nhắn (cursor-based pagination)
- **Redis cache:** cache conversation với TTL 60s, cache-aside pattern
- **User sync:** consume event `user.created` từ User Service để lưu user info vào MongoDB

Service nhận user identity qua header `x-user-id` (do Gateway inject) thay vì JWT trực tiếp.

---

## Cấu trúc file

```
services/chat-service/src/
├── index.ts                              ← Bootstrap
├── app.ts                                ← Express factory
├── config/
│   └── env.ts                            ← Env validation
├── types/
│   ├── conversation.ts                   ← Conversation, ConversationSummary interfaces
│   ├── message.ts                        ← Message, Reaction, MessageListOptions interfaces
│   └── express.d.ts                      ← Augment req.user
├── clients/
│   ├── mongo.client.ts                   ← MongoDB singleton client
│   └── redis.client.ts                   ← Redis singleton client (ioredis)
├── repositories/
│   ├── conversation.repository.ts        ← MongoDB CRUD for conversations
│   ├── message.repository.ts             ← MongoDB CRUD for messages
│   └── user.repository.ts                ← MongoDB CRUD for users (cache)
├── cache/
│   └── conversation.cache.ts             ← Redis cache layer for conversations
├── services/
│   ├── conversation.service.ts           ← Business logic + cache orchestration
│   └── message.service.ts                ← Business logic for messages
├── controllers/
│   └── conversation.controller.ts        ← Route handlers (cả conversation + message)
├── routes/
│   ├── index.ts                          ← Route registration
│   └── conversation.routes.ts            ← Route definitions
├── middleware/
│   ├── authenticated-user.ts             ← Attach user từ x-user-id header
│   └── error-handler.ts
├── messaging/
│   └── rabbitmq.consumer.ts              ← Consumer: user.created events
├── validation/
│   ├── conversation.schema.ts
│   ├── message.schema.ts
│   └── shared.schema.ts
└── utils/
    ├── auth.ts                           ← getAuthenticatedUser helper
    └── logger.ts
```

---

## `index.ts` — Bootstrap

```ts
const main = async () => {
  // Khởi động song song: MongoDB + Redis + RabbitMQ consumer
  await Promise.all([
    getMongoClient(),    // connect MongoDB
    connectRedis(),      // connect Redis
    startConsumers(),    // start RabbitMQ consumer
  ]);

  const app = createApp();
  const server = createServer(app);

  server.listen(env.CHAT_SERVICE_PORT, () => {
    logger.info({ port }, 'Chat service is running');
  });

  const shutdown = () => {
    Promise.all([closeRedis(), closeMongoClient()])
      .finally(() => server.close(() => process.exit(0)));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};
```

`Promise.all` khởi động 3 connections song song → startup nhanh hơn. Graceful shutdown đóng Redis và MongoDB, nhưng **chưa stop RabbitMQ consumer** — một thiếu sót nhỏ.

---

## `app.ts` — Express Factory

```ts
export const createApp = (): Application => {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Protect tất cả routes (trừ /health)
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
  CHAT_SERVICE_PORT:  z.coerce.number().int().min(0).max(65_535).default(4000),
  // ⚠️ default 4000 thay vì 4002 — nếu env không set, bị conflict với Gateway
  MONGO_URL:          z.string(),
  REDIS_URL:          z.string(),
  RABBITMQ_URL:       z.string().optional(),
  INTERNAL_API_TOKEN: z.string().min(16),
  JWT_SECRET:         z.string().min(32),
  // JWT_SECRET có trong env nhưng Chat Service không dùng để verify JWT
  // (user identity đến qua x-user-id header, không qua JWT)
});
```

> ⚠️ `CHAT_SERVICE_PORT` default là `4000` thay vì `4002` — nếu không set env, conflict với Gateway (port 4000). Trong docker-compose đã set đúng `CHAT_SERVICE_PORT=4002` nên không ảnh hưởng khi deploy.

---

## Types

### `types/conversation.ts`

```ts
export interface Conversation {
  id: string;
  title: string | null;             // Optional title, null nếu không có
  participantIds: string[];         // Array UUID của các thành viên
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date | null;       // Thời điểm tin nhắn cuối (null nếu chưa có)
  lastMessagePreview: string | null; // 120 ký tự đầu của tin nhắn cuối
}

export interface CreateConversationInput {
  title?: string | null;
  participantIds: string[];
}

export interface ConversationFilter {
  participantId: string;   // Lọc conversations theo user ID
}

export type ConversationSummary = Conversation;
// ConversationSummary hiện tại identical với Conversation
// Trong tương lai có thể bỏ bớt fields (e.g. bỏ participantIds để giảm payload)
```

### `types/message.ts`

```ts
export interface Reaction {
  emoji: string;
  userId: string;
  createdAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: Date;
  reactions: Reaction[];   // Nested array, không phải separate collection
}

export interface MessageListOptions {
  limit?: number;   // Default: 50, Max: 200
  after?: Date;     // Cursor: chỉ lấy messages SAU thời điểm này
}

// Các interface này được define nhưng chưa có API endpoint tương ứng
export interface AddReactionInput {
  messageId: string; conversationId: string; userId: string; emoji: string;
}
export interface RemoveReactionInput {
  messageId: string; conversationId: string; userId: string; emoji: string;
}
```

---

## `clients/mongo.client.ts` — MongoDB Singleton

```ts
let client: MongoClient | null = null;

export const getMongoClient = async (): Promise<MongoClient> => {
  if (client) return client;   // Singleton: trả về client đã có

  client = new MongoClient(env.MONGO_URL);
  await client.connect();
  logger.info('MongoDB connection established');

  return client;
};

export const closeMongoClient = async () => {
  if (!client) return;
  await client.close();
  logger.info('MongoDB connection closed');
  client = null;
};
```

**Không có connection pooling config** — dùng default của MongoDB driver (maxPoolSize=5). Tất cả repositories gọi `getMongoClient()` để lấy client dùng chung.

---

## `clients/redis.client.ts` — Redis Singleton (ioredis)

```ts
let redis: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,   // Không connect ngay khi khởi tạo
    });

    redis.on('error',     (error) => logger.error({ err: error }, 'Redis error'));
    redis.on('connect',   ()      => logger.info('Redis connection established'));
    redis.on('reconnect', ()      => logger.info('Redis reconnecting...'));
    redis.on('close',     ()      => logger.warn('Redis connection closed'));
  }

  return redis;
};

export const connectRedis = async () => {
  const client = getRedisClient();
  // Tránh double-connect
  if (client.status === 'ready' || client.status === 'connecting') return;
  await client.connect();
};

export const closeRedis = async () => {
  if (!redis) return;
  await redis.quit();   // Graceful: đợi pending commands xong
  redis = null;
};
```

`lazyConnect: true` + `connectRedis()` tách biệt: client được khởi tạo (event handlers gắn) nhưng chưa connect. `connectRedis()` mới thực sự mở connection → có thể setup trước, connect sau.

---

## `repositories/conversation.repository.ts`

### Mapper — MongoDB document → Domain object

```ts
const toConversation = (doc: WithId<Document>): Conversation => ({
  id: String(doc._id),
  title: typeof doc.title === 'string' ? doc.title : null,
  participantIds: Array.isArray(doc.participantIds) ? (doc.participantIds as string[]) : [],
  createdAt: new Date(doc.createdAt as string | number | Date),
  updatedAt: new Date(doc.updatedAt as string | number | Date),
  lastMessageAt: doc.lastMessageAt
    ? new Date(doc.lastMessageAt as string | number | Date)
    : null,
  lastMessagePreview: typeof doc.lastMessagePreview === 'string'
    ? doc.lastMessagePreview
    : null,
});
```

Mapper defensive: mỗi field đều guard type → không throw nếu document MongoDB có schema không khớp (thường xảy ra khi migrate data).

### `create(input): Promise<Conversation>`

```ts
async create(input: CreateConversationInput): Promise<Conversation> {
  const client = await getMongoClient();
  const collection = client.db().collection(CONVERSATIONS_COLLECTION);
  const now = new Date();

  const document = {
    _id: randomUUID(),          // String UUID thay vì ObjectId mặc định của Mongo
    title: input.title ?? null,
    participantIds: input.participantIds,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    lastMessagePreview: null,
  };

  await collection.insertOne(document as unknown as Document);
  return toConversation(document as unknown as WithId<Document>);
}
```

**`_id` là string UUID** thay vì `ObjectId` — đây là design choice quan trọng. Lợi: ID đồng nhất với Auth/User services. Hạn chế: mất một số MongoDB index optimization vì ObjectId có timestamp built-in.

### `findById(id: string): Promise<Conversation | null>`

```ts
async findById(id: string): Promise<Conversation | null> {
  const client = await getMongoClient();
  const doc = await client.db()
    .collection(CONVERSATIONS_COLLECTION)
    .findOne({ _id: id as unknown as ObjectId });
    // Cast sang ObjectId để TypeScript happy, nhưng thực tế _id là string

  return doc ? toConversation(doc) : null;
}
```

> ⚠️ `id as unknown as ObjectId` là type cast hack vì native MongoDB driver expect `_id` là `ObjectId`, nhưng repo dùng string UUID. Runtime vẫn hoạt động vì MongoDB so sánh bằng value, không phải type.

### `findSummaries(filter): Promise<ConversationSummary[]>`

```ts
async findSummaries(filter: ConversationFilter): Promise<ConversationSummary[]> {
  const client = await getMongoClient();
  const cursor = client.db()
    .collection(CONVERSATIONS_COLLECTION)
    .find({ participantIds: filter.participantId })
    // ⚠️ Dùng $eq ngầm: find({ participantIds: "uuid" })
    // MongoDB sẽ match nếu "uuid" nằm trong array participantIds
    .sort({ lastMessageAt: -1, updatedAt: -1 });

  const results = await cursor.toArray();
  return results.map(toConversationSummary);
}
```

MongoDB có behavior đặc biệt: `find({ participantIds: "uuid" })` tương đương `find({ participantIds: { $elemMatch: { $eq: "uuid" } } })` — match nếu "uuid" là element trong array. Đây là syntax sugar của MongoDB, không phải bug.

**Sort:** `lastMessageAt DESC` trước, rồi `updatedAt DESC` — conversations có tin nhắn gần nhất hiện trên đầu, conversations chưa có tin nhắn sort theo thời gian tạo.

### `touchConversation(conversationId, preview): Promise<void>`

```ts
async touchConversation(conversationId: string, preview: string): Promise<void> {
  const client = await getMongoClient();
  await client.db()
    .collection(CONVERSATIONS_COLLECTION)
    .updateOne(
      { _id: conversationId as unknown as ObjectId },
      {
        $set: {
          lastMessageAt:      new Date(),
          lastMessagePreview: preview,    // Tối đa 120 ký tự (cắt ở service layer)
          updatedAt:          new Date(),
        },
      },
    );
}
```

Được gọi mỗi lần có tin nhắn mới trong conversation → cập nhật preview và thời gian.

### `removeAll(): Promise<void>`

```ts
async removeAll(): Promise<void> {
  const client = await getMongoClient();
  const db = client.db();
  await Promise.all([
    db.collection(CONVERSATIONS_COLLECTION).deleteMany({}),
    db.collection(MESSAGES_COLLECTION).deleteMany({}),
  ]);
}
```

Utility method dọn sạch data — dùng cho testing, không expose qua API.

---

## `repositories/message.repository.ts`

### Mapper

```ts
const toMessage = (doc: WithId<Document>): Message => ({
  id:             String(doc._id),
  conversationId: String(doc.conversationId),
  senderId:       String(doc.senderId),
  body:           String(doc.body),
  createdAt:      new Date(doc.createdAt as string | number | Date),
  reactions: Array.isArray(doc.reactions)
    ? doc.reactions.map((r: WithId<Document>) => ({
        emoji:     String(r.emoji),
        userId:    String(r.userId),
        createdAt: new Date(r.createdAt as string | number | Date),
      }))
    : [],
});
```

### `create(conversationId, senderId, body): Promise<Message>`

```ts
async create(conversationId: string, senderId: string, body: string): Promise<Message> {
  const client = await getMongoClient();
  const collection = client.db().collection(MESSAGES_COLLECTION);
  const now = new Date();

  const document = {
    _id: randomUUID(),   // String UUID
    conversationId,
    senderId,
    body,
    createdAt: now,
    // reactions: [] — không set, mặc định Mongo không có field này
    // toMessage() sẽ fallback về [] nếu reactions không tồn tại
  };

  await collection.insertOne(document as unknown as Document);
  return toMessage(document as unknown as WithId<Document>);
}
```

> **Lưu ý:** `reactions` không được init là `[]` khi tạo message — document MongoDB sẽ không có field `reactions`. `toMessage()` guard `Array.isArray(doc.reactions)` → trả `[]` nếu undefined. Hoạt động đúng nhưng document schema không nhất quán.

### `findByConversation(conversationId, options): Promise<Message[]>`

```ts
async findByConversation(
  conversationId: string,
  options: MessageListOptions = {},
): Promise<Message[]> {
  const client = await getMongoClient();
  const query: Record<string, unknown> = { conversationId };

  // Cursor-based pagination: chỉ lấy messages SAU timestamp
  if (options.after) {
    query.createdAt = { $gt: options.after };   // after là Date object
  }

  const cursor = client.db()
    .collection(MESSAGES_COLLECTION)
    .find(query)
    .sort({ createdAt: -1 })     // Newest first
    .limit(options.limit ?? 50); // Default 50, max 200

  const messages = await cursor.toArray();
  return messages.map(toMessage);
}
```

**Cursor-based pagination với `after`:**
- `after` là một `Date` — lấy messages có `createdAt > after`
- Sort `DESC` + `$gt` → kết quả là messages mới hơn `after`, sorted newest-first
- Client cần reverse array để hiển thị đúng thứ tự (cũ → mới)

### `findById(messageId: string): Promise<Message | null>`

```ts
async findById(messageId: string): Promise<Message | null> {
  const client = await getMongoClient();
  const doc = await client.db()
    .collection(MESSAGES_COLLECTION)
    .findOne({ _id: messageId } as unknown as Document);
  return doc ? toMessage(doc) : null;
}
```

---

## `repositories/user.repository.ts` — User Cache trong MongoDB

Chat Service lưu một bản copy của user data trong MongoDB collection `users` — được sync qua RabbitMQ event.

```ts
interface UserDocument {
  _id: string;         // userId UUID
  email: string;
  displayName: string;
  createdAt: string;   // ISO string (khác với Conversation/Message dùng Date)
  updatedAt: string;
}

const COLLECTION_NAME = 'users';
```

### `upsertUser(payload): Promise<void>`

```ts
async upsertUser(payload: UserCreatedPayload) {
  const collection = await getCollection();
  await collection.updateOne(
    { _id: payload.id },
    {
      $set: {
        _id:         payload.id,
        email:       payload.email,
        displayName: payload.displayName,
        createdAt:   payload.createdAt,
        updatedAt:   payload.updatedAt,
      },
    },
    { upsert: true },   // Insert nếu chưa có, update nếu có rồi
  );
}
```

### `findUserById(id): Promise<UserDocument | null>`

```ts
async findUserById(id: string): Promise<UserDocument | null> {
  const collection = await getCollection();
  return collection.findOne({ _id: id });
}
```

**Tại sao Chat Service cần lưu user?**  
Để có thể hiển thị thông tin người gửi (displayName, avatar) khi list messages mà không cần call sang User Service cho mỗi message — local cache trong cùng DB.

---

## `cache/conversation.cache.ts` — Redis Cache Layer

```ts
const CACHE_PREFIX = 'conversation:';
const CACHE_TTL_SECONDS = 60;   // 1 phút

// Key format: "conversation:uuid-string"
```

### Serialize / Deserialize

```ts
const serialize = (conversation: Conversation): string => {
  return JSON.stringify({
    ...conversation,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    // lastMessageAt: vẫn là Date object trong spread → JSON.stringify tự convert
  });
};

const deserialize = (raw: string): Conversation => {
  const parsed = JSON.parse(raw) as Conversation & {
    createdAt: string;
    updatedAt: string;
  };
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    updatedAt: new Date(parsed.updatedAt),
    // ⚠️ lastMessageAt không được convert lại → vẫn là string sau deserialize
  };
};
```

> ⚠️ **Bug tiềm ẩn:** `lastMessageAt` trong `Conversation` là `Date | null`, nhưng sau `deserialize()` nó sẽ là `string | null` (vì `JSON.parse` không tự convert string → Date). Code downstream dùng `conversation.lastMessageAt` như Date có thể bị lỗi.

### Cache operations

```ts
export const conversationCache = {
  async get(conversationId: string): Promise<Conversation | null> {
    const redis = getRedisClient();
    const payload = await redis.get(`${CACHE_PREFIX}${conversationId}`);
    return payload ? deserialize(payload) : null;
  },

  async set(conversation: Conversation): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(
      `${CACHE_PREFIX}${conversation.id}`,
      CACHE_TTL_SECONDS,     // TTL: 60 giây
      serialize(conversation),
    );
    // setex = SET + EXPIRE trong một lệnh — atomic
  },

  async delete(conversationId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(`${CACHE_PREFIX}${conversationId}`);
  },
};
```

---

## `services/conversation.service.ts` — Cache-Aside Pattern

```ts
export const conversationService = {
  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const conversation = await conversationRepository.create(input);
    await conversationCache.set(conversation);   // Populate cache ngay khi tạo
    return conversation;
  },

  async getConversationById(id: string): Promise<Conversation> {
    // 1. Check cache trước
    const cached = await conversationCache.get(id);
    if (cached) return cached;

    // 2. Cache miss → query MongoDB
    const conversation = await conversationRepository.findById(id);
    if (!conversation) throw new HttpError(404, 'Conversation not found');

    // 3. Populate cache cho lần sau
    await conversationCache.set(conversation);
    return conversation;
  },

  async listConversation(filter: ConversationFilter): Promise<ConversationSummary[]> {
    // List không cache (danh sách thay đổi liên tục)
    return conversationRepository.findSummaries(filter);
  },

  async touchConversation(conversationId: string, preview: string): Promise<void> {
    await conversationRepository.touchConversation(conversationId, preview);
    // Invalidate cache sau khi update để tránh stale data
    await conversationCache.delete(conversationId);
  },
};
```

**Cache-Aside (Lazy Loading) pattern:**

```
Read:  App → Cache HIT? → Return từ cache
              Cache MISS? → Query DB → Store vào cache → Return

Write: App → Update DB → Invalidate cache (không update cache trực tiếp)
```

**Tại sao invalidate thay vì update cache khi write?**  
Đơn giản và an toàn hơn. Nếu update cache sau write mà bị lỗi giữa chừng → cache stale. Invalidate đảm bảo lần đọc tiếp theo sẽ lấy data fresh từ DB.

---

## `services/message.service.ts`

### `createMessage(conversationId, senderId, body): Promise<Message>`

```ts
async createMessage(conversationId: string, senderId: string, body: string): Promise<Message> {
  // 1. Verify conversation tồn tại (có cache nên nhanh)
  const conversation = await conversationService.getConversationById(conversationId);

  // 2. Verify sender là participant
  if (!conversation.participantIds.includes(senderId)) {
    throw new HttpError(403, 'Sender is not part of this conversation');
  }

  // 3. Insert message vào MongoDB
  const message = await messageRepository.create(conversationId, senderId, body);

  // 4. Update conversation preview + invalidate cache
  await conversationService.touchConversation(conversationId, body.slice(0, 120));
  //                                                           ↑ Cắt 120 ký tự đầu làm preview

  return message;
},
```

**Thứ tự các bước quan trọng:** insert message trước, rồi mới touch conversation. Nếu touch fail → message đã tồn tại nhưng preview không được update. Có thể chấp nhận được (preview chỉ là UI convenience).

### `listMessages(conversationId, requesterId, options): Promise<Message[]>`

```ts
async listMessages(
  conversationId: string,
  requesterId: string,
  options: MessageListOptions = {},
): Promise<Message[]> {
  // Re-use conversationService để tận dụng cache
  const conversation = await conversationService.getConversationById(conversationId);

  if (!conversation.participantIds.includes(requesterId)) {
    throw new HttpError(403, 'Requester is not part of this conversation');
  }

  return messageRepository.findByConversation(conversationId, options);
},
```

---

## `controllers/conversation.controller.ts`

Controller xử lý cả conversation lẫn message (vì message endpoint nằm dưới `/conversations/:id/messages`).

### `createConversationHandler`

```ts
export const createConversationHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const payload = createConversationSchema.parse(req.body);

  // Deduplicate + tự thêm creator vào participants
  const uniqueParticipantIds = Array.from(new Set([...payload.participantIds, user.id]));

  if (uniqueParticipantIds.length < 2) {
    throw new HttpError(400, 'Conversation must atleast include one other participant');
    // ⚠️ Typo: "atleast" thay vì "at least" (giống Gateway Service)
  }

  const conversation = await conversationService.createConversation({
    title: payload.title,
    participantIds: uniqueParticipantIds,
  });

  res.status(201).json({ data: conversation });
});
```

### `listConversationHandler`

```ts
export const listConversationHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const filter = listConversationsQuerySchema.parse(req.query);

  // Guard: không cho list conversation của người khác
  if (filter.participantId && filter.participantId !== user.id) {
    throw new HttpError(403, 'Unauthorized');
  }

  const conversations = await conversationService.listConversation({ participantId: user.id });

  res.status(201).json({ data: conversations });
  // ⚠️ Bug: res.status(201) cho GET request — nên là 200
});
```

> ⚠️ **Bug:** `listConversationHandler` và `getConversationHandler` trả `201 Created` cho GET requests — nên là `200 OK`. Không ảnh hưởng functionality nhưng vi phạm HTTP semantics.

### `getConversationHandler`

```ts
export const getConversationHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const conversationId = parsedConversation(req.params);   // validate UUID

  const conversation = await conversationService.getConversationById(conversationId);

  // Double-check authorization (conversation service không check participant)
  if (!conversation.participantIds.includes(user.id)) {
    throw new HttpError(403, 'Unauthorized');
  }

  res.status(201).json({ data: conversation });  // ⚠️ Bug: 201 thay vì 200
});
```

### `createMessageHandler`

```ts
export const createMessageHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const conversationId = parsedConversation(req.params);
  const payload = createMessageBodySchema.parse(req.body);

  const message = await messageService.createMessage(conversationId, user.id, payload.body);

  res.status(201).json({ data: message });
});
```

### `listMessageHandler`

```ts
export const listMessageHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const conversationId = parsedConversation(req.params);
  const query = listMessagesQuerySchema.parse(req.query);

  // Convert string datetime → Date object cho cursor
  const after = query.after ? new Date(query.after) : undefined;

  const messages = await messageService.listMessages(conversationId, user.id, {
    limit: query.limit,
    after,
  });

  res.json({ data: messages });
});
```

---

## `middleware/authenticated-user.ts`

```ts
const userIdSchema = z.string().uuid();

export const attachAuthenticatedUser: RequestHandler = (req, _res, next) => {
  try {
    const headerValue = req.header(USER_ID_HEADER);   // 'x-user-id'
    const userId = userIdSchema.parse(headerValue);    // Validate phải là UUID hợp lệ
    req.user = { id: userId };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or missing user context'));
  }
};
```

**Khác với Gateway `requireAuth`:** Không verify JWT — chỉ đọc `x-user-id` header và validate format UUID. Tin tưởng rằng chỉ Gateway (đã xác thực JWT) mới có thể set header này.

Bảo mật được đảm bảo bởi:
1. `createInternalAuthMiddleware` chặn mọi request không có `X-Internal-Token` hợp lệ
2. Chỉ Gateway mới biết `INTERNAL_API_TOKEN` và set đúng `x-user-id`

---

## `middleware/error-handler.ts`

```ts
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error({ err }, 'Unhandled error occurred');

  const error = err instanceof HttpError ? err : undefined;
  const statusCode = error?.statusCode ?? 500;
  const message = statusCode >= 500
    ? 'Internal Server Error'
    : (error?.message ?? 'Unknown Error');
  const payload = error?.details
    ? { message, details: error.details }
    : { message };

  res.status(statusCode).json(payload);
};
```

Identical với các services khác — pattern dùng chung.

---

## Routes

### `routes/conversation.routes.ts`

```ts
export const conversationRouter: Router = Router();

// requireAuth bằng cách đọc x-user-id header (không JWT)
conversationRouter.use(attachAuthenticatedUser);

conversationRouter.post('/',
  validateRequest({ body: createConversationSchema }),
  createConversationHandler);

conversationRouter.get('/',
  validateRequest({ query: listConversationsQuerySchema }),
  listConversationHandler);

conversationRouter.get('/:id',
  validateRequest({ params: conversationIdParamsSchema }),
  getConversationHandler);

conversationRouter.post('/:id/messages',
  validateRequest({ params: conversationIdParamsSchema, body: createMessageBodySchema }),
  createMessageHandler);

conversationRouter.get('/:id/messages',
  validateRequest({ params: conversationIdParamsSchema, query: listMessagesQuerySchema }),
  listMessageHandler);
```

---

## Validation Schemas

### `validation/conversation.schema.ts`

```ts
export const createConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  participantIds: z.array(z.string().uuid()).min(1),
});

export const listConversationsQuerySchema = z.object({
  participantId: z.string().uuid().optional(),
});
```

### `validation/message.schema.ts`

```ts
export const createMessageBodySchema = z.object({
  body: z.string().min(1).max(2000),
});

// Extended schema (dùng nội bộ, không expose qua route)
export const createMessageSchema = createMessageBodySchema.extend({
  conversationId: z.string().uuid(),
});

export const listMessagesQuerySchema = z.object({
  limit: z.preprocess(
    (value) => (value === undefined ? undefined : Number(value)),
    z.number().int().min(1).max(200),
  ).optional(),
  after: z.string().datetime().optional(),  // ISO 8601: "2024-01-15T10:30:00.000Z"
});
```

`z.preprocess` khác `z.coerce`: `preprocess` chạy transform trước khi validate type, `coerce` là built-in coercion. Cả hai đều convert `"50"` → `50`.

### `validation/shared.schema.ts`

```ts
export const conversationIdParamsSchema = z.object({
  id: z.string().uuid(),
});
```

---

## `messaging/rabbitmq.consumer.ts` — User Events Consumer

Consumer lắng nghe event `user.created` từ User Service để sync user info vào MongoDB.

```ts
const EVENT_QUEUE = 'chat-service.user-events';

export const startConsumers = async () => {
  if (!env.RABBITMQ_URL) {
    logger.info('RabbitMQ URL not configured; consumers disabled');
    return;
  }

  const conn = await connect(env.RABBITMQ_URL);
  const ch = await conn.createChannel();

  await ch.assertExchange(USER_EVENTS_EXCHANGE, 'topic', { durable: true });
  const queue = await ch.assertQueue(EVENT_QUEUE, { durable: true });
  await ch.bindQueue(queue.queue, USER_EVENTS_EXCHANGE, USER_CREATED_ROUTING_KEY);
  // bind 'chat-service.user-events' → 'user.events' → 'user.created'
```

### Message handler

```ts
const handleUserCreated = async (event: UserCreatedEvent) => {
  await userRepository.upsertUser(event.payload);
  // Upsert vào MongoDB collection 'users'
};

const consumeHandler = (message: ConsumeMessage | null) => {
  if (!message) return;

  void (async () => {
    const payload = message.content.toString('utf-8');
    const event = JSON.parse(payload) as UserCreatedEvent;
    await handleUserCreated(event);
    ch.ack(message);
  })().catch((error: unknown) => {
    logger.error({ err: error }, 'Failed to process event');
    ch.nack(message, false, false);   // Drop nếu lỗi (không requeue)
  });
};
```

---

## `utils/auth.ts`

```ts
export const getAuthenticatedUser = (req: Request): AuthenticatedUser => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');
  return req.user;
};
```

---

## Luồng hoàn chỉnh: Send Message

```
Client: POST /conversations/conv-uuid/messages
  Body: { "body": "Hello!" }
  Header: Authorization: Bearer <jwt>
        ↓
[Gateway]
  requireAuth: verify JWT → req.user = { id: 'user-uuid' }
  validateRequest: body.min(1).max(2000)
  createMessageHandler:
    getAuthenticatedUser(req) → { id: 'user-uuid' }
    chatProxyService.createMessage('conv-uuid', 'user-uuid', { body: 'Hello!' })
      axios.post('http://chat-service:4002/conversations/conv-uuid/messages',
        { body: 'Hello!' },
        { headers: { 'X-Internal-Token': '...', 'x-user-id': 'user-uuid' } })
        ↓
[Chat Service]
  createInternalAuthMiddleware: verify X-Internal-Token ✓
  attachAuthenticatedUser: x-user-id → req.user = { id: 'user-uuid' }
  validateRequest: params.id UUID, body.min(1).max(2000)
  createMessageHandler:
    getAuthenticatedUser → { id: 'user-uuid' }
    parsedConversation(params) → 'conv-uuid'
    messageService.createMessage('conv-uuid', 'user-uuid', 'Hello!')
      ↓
      conversationService.getConversationById('conv-uuid')
        → conversationCache.get('conv-uuid')
            MISS: conversationRepository.findById('conv-uuid')  [MongoDB]
            → conversationCache.set(conv, TTL=60s)              [Redis]
        → { id: 'conv-uuid', participantIds: ['user-uuid', ...] }
      ↓
      Check: 'user-uuid' ∈ participantIds ✓
      ↓
      messageRepository.create('conv-uuid', 'user-uuid', 'Hello!')
        → MongoDB insertOne collection 'messages'
        → { id: 'msg-uuid', body: 'Hello!', createdAt: Date, reactions: [] }
      ↓
      conversationService.touchConversation('conv-uuid', 'Hello!')
        → conversationRepository.updateOne($set lastMessageAt, lastMessagePreview)  [MongoDB]
        → conversationCache.delete('conv-uuid')  [Redis invalidate]
      ↓
  res.status(201).json({ data: message })
```

---

## MongoDB Collections Summary

### Collection: `conversations`

| Field | Type | Mô tả |
|-------|------|--------|
| `_id` | string (UUID) | Conversation ID |
| `title` | string \| null | Tên conversation (optional) |
| `participantIds` | string[] | Array user IDs |
| `createdAt` | Date | Thời gian tạo |
| `updatedAt` | Date | Thời gian cập nhật |
| `lastMessageAt` | Date \| null | Thời điểm tin nhắn cuối |
| `lastMessagePreview` | string \| null | 120 ký tự đầu tin nhắn cuối |

**Query patterns:**
- `findOne({ _id: id })` — get by ID
- `find({ participantIds: userId })` — list by participant (array element match)
- `updateOne({ _id: id }, { $set: { lastMessageAt, lastMessagePreview, updatedAt } })` — touch

### Collection: `messages`

| Field | Type | Mô tả |
|-------|------|--------|
| `_id` | string (UUID) | Message ID |
| `conversationId` | string | FK → conversations._id |
| `senderId` | string | FK → users._id |
| `body` | string | Nội dung tin nhắn (max 2000 chars) |
| `createdAt` | Date | Thời gian gửi |
| `reactions` | Reaction[] | Array reactions (có thể không tồn tại) |

**Query patterns:**
- `find({ conversationId }).sort({ createdAt: -1 }).limit(50)` — list messages
- `find({ conversationId, createdAt: { $gt: after } }).sort({ createdAt: -1 })` — paginated

### Collection: `users`

| Field | Type | Mô tả |
|-------|------|--------|
| `_id` | string | userId UUID (sync từ User Service) |
| `email` | string | Email |
| `displayName` | string | Tên hiển thị |
| `createdAt` | string | ISO string (không phải Date) |
| `updatedAt` | string | ISO string |

**Query patterns:**
- `findOne({ _id: id })` — lookup user để hiển thị trong message list
- `updateOne({ _id: id }, { $set: {...} }, { upsert: true })` — sync từ RabbitMQ

---

## Redis Keys

| Key pattern | Kiểu | TTL | Mô tả |
|------------|------|-----|--------|
| `conversation:<uuid>` | String (JSON) | 60s | Cache conversation object |

---

## Tổng hợp Bug & Cải thiện

| Vị trí | Vấn đề | Mức độ |
|--------|--------|--------|
| `config/env.ts` | `CHAT_SERVICE_PORT` default `4000` thay vì `4002` | Thấp (bị override bởi docker-compose) |
| `cache/conversation.cache.ts` | `lastMessageAt` không convert về `Date` sau deserialize | Trung bình |
| `conversation.controller.ts` | `listConversation` và `getConversation` trả `201` thay vì `200` | Thấp |
| `conversation.controller.ts` | Typo `"atleast"` thay vì `"at least"` | Rất thấp |
| `message.repository.ts` | `reactions` field không được khởi tạo khi tạo message | Thấp |
| `index.ts` | Graceful shutdown không stop RabbitMQ consumer | Trung bình |
| `repositories/*.ts` | `id as unknown as ObjectId` — type cast hack | Thấp (hoạt động đúng) |
| `rabbitmq.consumer.ts` | `nack requeue=false` — message lỗi bị drop, không có DLQ | Trung bình |
| `socket.io` dependency | Có trong `package.json` nhưng chưa implement | N/A |
