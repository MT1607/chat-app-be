# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root using pnpm workspaces.

```bash
# Start all services in dev mode (hot-reload via tsx watch)
pnpm dev

# Run a single service in dev mode
pnpm --filter @chat-app-be/auth-service dev
pnpm --filter @chat-app-be/user-service dev
pnpm --filter @chat-app-be/gateway-service dev
pnpm --filter @chat-app-be/chat-service dev

# Build all services
pnpm build

# Type-check a single service (no emit)
pnpm --filter @chat-app-be/chat-service typecheck

# Lint / format
pnpm lint
pnpm format

# Start infrastructure (MySQL, PostgreSQL, MongoDB, Redis, RabbitMQ)
docker compose up -d
```

## Architecture

This is a **pnpm monorepo** (`pnpm-workspace.yaml`) containing four microservices and one shared package.

```
packages/common/          # Shared utilities imported by all services
services/
  auth-service/           # JWT authentication — port 4003, MySQL
  user-service/           # User profiles — port 5432 PostgreSQL consumer
  chat-service/           # Conversations & real-time — port 4002, MongoDB + Redis
  gateway-service/        # Public API gateway — port 4000, HTTP proxy only
```

### Service responsibilities

**gateway-service** is the only public-facing service. It validates JWTs from incoming requests and proxies HTTP calls to `auth-service` and `user-service` using axios with an `x-internal-token` header for internal auth.

**auth-service** handles registration/login, stores credentials in MySQL via Sequelize, issues JWTs, and publishes `auth.user.registered` events to the `auth.events` RabbitMQ topic exchange.

**user-service** consumes `auth.events` (queue `auth-service.auth-events`) to sync user records into PostgreSQL. It also publishes its own events to the `user.events` exchange.

**chat-service** consumes `user.events` (queue `chat-service.user-events`) to maintain a local user shadow table in MongoDB. Conversations are stored in MongoDB, with Redis used as a read-through cache in front of the conversation repository.

### Cross-service communication

| Path | Transport | Key |
|---|---|---|
| Client → Gateway | HTTP | JWT in `Authorization` header |
| Gateway → Auth/User | HTTP (axios) | `x-internal-token` header |
| Auth → User | RabbitMQ topic exchange `auth.events` | routing key `auth.user.registered` |
| User → Chat | RabbitMQ topic exchange `user.events` | routing key `user.created` |

### Shared package (`@chat-app-be/common`)

All services import from `@chat-app-be/common`. Key exports:

- `createEnv(schema, opts)` — validates `process.env` against a Zod schema at startup; exits if required vars are missing
- `HttpError` — throw this in service/controller code; caught by the error-handling middleware
- `asyncHandler` — wraps async Express route handlers to forward errors
- `validateRequest(schema)` — Zod middleware for request bodies
- `createInternalAuthMiddleware(token)` — protects internal service routes with `x-internal-token`
- Event constants and payload types (`AUTH_EVENT_EXCHANGE`, `AUTH_USER_REGISTERED_ROUTING_KEY`, `USER_EVENT_EXCHANGE`, `USER_CREATED_ROUTING_KEY`, etc.)

### Conventions

- All packages use `"type": "module"` (ESNext). Import paths must include the file extension when referencing local files directly.
- Each service has a `@/` path alias pointing to its own `src/` directory (configured in each service's `tsconfig.json`).
- Environment variables are loaded and validated in `src/config/env.ts` using `createEnv` from `@chat-app-be/common`. Add new vars there with a Zod schema.
- Logging is done with `pino` via a shared `logger` utility. Use structured logging: `logger.info({ key: value }, 'message')`.
- The repository pattern separates DB access (`src/repositories/`) from business logic (`src/services/`) from HTTP handling (`src/controllers/`).

### Infrastructure (docker-compose.yml)

| Service | Image | Default port |
|---|---|---|
| auth-service-db | MySQL 8.0 | 3306 |
| user-service-db | PostgreSQL 16 | 5432 |
| mongodb | MongoDB 7.0 | 27017 |
| redis | Redis 7 | 6379 |
| rabbitmq | RabbitMQ 4 + management UI | 5672 / 15672 |
