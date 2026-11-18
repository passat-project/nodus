---
title: Cache Frequently Used Data with Redis
impact: HIGH
section: 2
impactDescription: Dramatically reduces database load and improves response times
tags: performance, caching, redis, scalability, prisma, events
---

Every database query adds latency and load. Redis 8 is already part of the platform (BullMQ, rate limiting, event fanout) — reuse it for cache-aside caching of hot, read-heavy data: sub-millisecond reads instead of repeated PostgreSQL round-trips. **Cache read-heavy endpoints and expensive computations; invalidate through domain events.**

## For AI Agents

### Step 1: Identify What Deserves Caching

Cache data that is **read often and written rarely**:

- `dictionaries` entries (I15) — business lists and statuses read on nearly every screen, changed by an administrator once in a while. The prime caching candidate.
- Workflow stage definitions, project metadata, user directory cards.
- Expensive aggregates (dashboard counters) with a tolerance for seconds-old data.

Do **not** cache:

- Real-time data (chat messages, presence) — the WS gateway pushes updates; a cache only adds staleness.
- Per-request auth context, RBAC decisions on individual mutations.
- Anything whose staleness breaks a business invariant (e.g., available seats in an approval step).
- Audit data — writes must never be deferred or deduplicated.

### Step 2: Use the Shared Cache Service from `infra/`

One cache client for the whole API process, next to the Redis client used by BullMQ. Modules inject `CacheService`; they never instantiate `ioredis` themselves.

```typescript
// ✅ File: apps/api/src/infra/redis/cache.service.ts
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class CacheService {
  constructor(private readonly redis: Redis) {} // shared client from infra/redis

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    return data ? (JSON.parse(data) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.redis.del(...keys);
  }

  /** Scan-based delete by prefix — fine for invalidation paths, not hot paths. */
  async delByPrefix(prefix: string): Promise<void> {
    const stream = this.redis.scanStream({ match: `${prefix}*`, count: 100 });
    for await (const keys of stream) {
      if (keys.length) await this.redis.del(...keys);
    }
  }
}
```

### Step 3: Key Conventions and Serialization Rules

```typescript
// ✅ Key format: nodus:<module>:<entity>[:<id>][:<variant>]
const key = `nodus:tasks:task:${taskId}`;         // single entity
const listKey = `nodus:dictionaries:task_status`; // dictionary list
```

Rules:

- **`nodus:` prefix always.** The dev host runs other projects (see AGENTS.md gotchas) and BullMQ/rate-limit keys share the instance — the prefix avoids collisions and enables `delByPrefix('nodus:tasks:')`.
- **Cache payload = contract shape.** Store what the API returns (already serialized via the response DTO), not raw Prisma rows. Then a cache hit is returned directly without re-serialization, and a schema change in `@nodus/contracts` is the signal to bump the key variant.
- **Dates come back as strings.** `JSON.parse` does not revive `Date` objects — this is exactly why cached payloads must be the contract shape, where dates are already UTC ISO 8601 strings (I7). Never cache raw Prisma rows and then discover `createdAt.getTime is not a function` downstream.
- **Jitter the TTL** (`ttl = 300 + random(0..30)`) on keys shared by many keys of the same kind, so a mass write does not expire all at once (cache avalanche).

### Step 4: Cache-Aside in the Service Layer

The repository stays Prisma-only (patterns.md); caching is an orchestration concern of the service:

```typescript
// ❌ WRONG - DB hit on every request 🚨
// tasks/tasks.service.ts
async getTaskCard(id: string) {
  return this.tasksRepository.findCardById(id); // heavy join, called per view
}

// ✅ CORRECT - cache-aside with contract-shaped payload
// tasks/tasks.service.ts
@Injectable()
export class TasksService {
  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly cache: CacheService,
  ) {}

  async getTaskCard(id: string) {
    const key = `nodus:tasks:task:${id}`;

    const cached = await this.cache.get<TaskCardResponse>(key);
    if (cached) return cached; // ✅ sub-millisecond hit

    const row = await this.tasksRepository.findCardById(id);
    if (!row) throw new DomainException(ErrorCode.NOT_FOUND, 'Task not found');

    const card = taskCardResponseSchema.parse(row); // contract shape
    await this.cache.set(key, card, 300); // 5 min ✅
    return card;
  }
}
```

Cache-aside flow: **read cache → miss → read DB → serialize → write cache → return.** On writes, do not update the cache entry — delete it and let the next read repopulate (write-through invites partial-update bugs).

### Step 5: Invalidate Through Domain Events

TTL alone means up to `ttl` seconds of stale data. The platform already publishes domain events for every change (I9) — subscribe and invalidate precisely. The handler lives in `events/` of the owning module and must be idempotent (events can be redelivered):

```typescript
// ✅ File: apps/api/src/modules/tasks/events/task-updated.handler.ts
// (CacheService — будущий core-примитив поверх core/redis/redis.module.ts:
//  заводится с первым кэшем, I13; сейчас кэша в api нет)
import { Injectable } from '@nestjs/common';
import type { DomainEvent } from '@nodus/contracts';
import { CacheService } from '../../../core/redis/cache.service.js';

@Injectable()
export class TaskUpdatedCacheHandler {
  // ✅ Один обработчик на ГРУППУ каталожных событий: ядро подписывает все
  //    типы из `eventTypes` на бутстрапе (декораторы запрещены; канон —
  //    patterns.md, `eventTypes` на классе)
  static readonly eventTypes = ['task.updated'];

  constructor(private readonly cache: CacheService) {}

  async handle(event: DomainEvent<{ taskId: string }>): Promise<void> {
    // ✅ idempotent: deleting an absent key is a no-op, safe on redelivery
    await this.cache.del(`nodus:tasks:task:${event.payload.taskId}`);
  }
}
```

Соседние события того же агрегата (`task.status_changed`, `task.completed`) добавляются строками в `eventTypes` того же обработчика, а не файлами-близнецами: группу событий одного агрегата обрабатывает один класс.

For `dictionaries`, invalidation on the admin write — a direct `delByPrefix('nodus:dictionaries:')` in the admin mutation (a dedicated `directory.*` event would first go to the api-conventions catalog) — plus a long TTL (30–60 min) gives effectively instant consistency for near-static data.

### Step 6: Guard Against the Classic Failure Modes

| Failure mode | Symptom | Mitigation |
|---|---|---|
| **Stampede** (hot key expires, 50 requests rebuild it at once) | DB spike every `ttl` | Short jitter on TTL; for the hottest keys, a per-key lock (`SET key:lock NX EX 5`) where the loser serves stale-or-waits |
| **Penetration** (queries for IDs that don't exist bypass the cache) | DB hammered by 404-style lookups | Cache the negative result briefly (`null` payload, 30 s TTL) — the not-found path above is where it belongs |
| **Avalanche** (thousands of keys share one TTL and expire together) | Periodic DB stampedes | TTL jitter per key (Step 3) |

Do not over-engineer: most portal data needs only TTL + event invalidation. Reach for locks when a single key is demonstrably hot (k6 profile, `non-functional-requirements.md`).

### Step 7: Test the Behavior, Not the Cache Itself

Unit tests mock `CacheService` (it is infrastructure); assert the orchestration:

```typescript
// ✅ File: apps/api/src/modules/tasks/tasks.service.test.ts
import { describe, expect, it, vi } from 'vitest';
import { TasksService } from './tasks.service';

function makeService({ cached, row }: { cached: unknown; row: unknown }) {
  const cache = { get: vi.fn().mockResolvedValue(cached), set: vi.fn(), del: vi.fn() };
  const repository = { findCardById: vi.fn().mockResolvedValue(row) };
  // @ts-expect-error - minimal stubs for orchestration test
  return { service: new TasksService(repository, cache), cache, repository };
}

describe('TasksService.getTaskCard caching', () => {
  it('serves from cache without touching the repository', async () => {
    const { service, repository } = makeService({ cached: { id: 't1' }, row: null });
    await service.getTaskCard('t1');
    expect(repository.findCardById).not.toHaveBeenCalled();
  });

  it('populates the cache with the contract-shaped payload on miss', async () => {
    const row = { id: 't1', title: 'Проверка', createdAt: new Date() };
    const { service, cache } = makeService({ cached: null, row });
    await service.getTaskCard('t1');
    expect(cache.set).toHaveBeenCalledWith(
      'nodus:tasks:task:t1',
      expect.objectContaining({ id: 't1' }),
      300,
    );
  });
});
```

## Quick Reference Checklist

- [ ] Candidate is read-heavy/write-rare (dictionaries, cards, aggregates) — not real-time data
- [ ] Shared `CacheService` from `infra/redis/`, no per-module `ioredis` instances
- [ ] Keys prefixed `nodus:<module>:...`, deletable by prefix
- [ ] Cached payload is the contract (response DTO) shape — dates already ISO strings
- [ ] Repository untouched by caching; cache-aside lives in the service
- [ ] Writes invalidate (delete), never update-in-place
- [ ] Event-driven invalidation for entity caches; handler is idempotent
- [ ] TTL with jitter on multi-key namespaces; negative caching on hot 404 paths
- [ ] Orchestration covered by Vitest with mocked `CacheService`
