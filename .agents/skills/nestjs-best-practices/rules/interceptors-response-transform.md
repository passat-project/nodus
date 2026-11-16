---
title: Never Return Raw Database Rows — Serialize Responses via Contract DTOs
impact: MEDIUM
impactDescription: Prevents sensitive data leaks and ensures consistent response format
section: 14
tags: interceptors, serialization, zod, contracts, response, security, prisma
---

Returning raw database rows (Prisma models) from controllers can leak sensitive data (password hashes, internal fields) and produces inconsistent response shapes. In Nodus there is **no** `class-transformer`, **no** entity decorators, and **no** `WrapResponseInterceptor` — a `{ success, data, timestamp }` envelope is explicitly forbidden by `docs/architecture/api-conventions.md`.

The serialization layer is three mechanisms working together:

1. **Response zod schemas in `@nodus/contracts`** — the single source of truth for what an endpoint returns. One schema serves both backend serialization and frontend types.
2. **Repository `select`** — sensitive columns (`passwordHash`, internal notes) are never read from the database in the first place. Prisma only lives in `*.repository.ts`.
3. **Global exception filter (core)** — every error leaves the API in the unified `{ code, message, details?, traceId }` shape; success responses carry **no envelope**.

Successful response shapes (fixed, do not invent others):

- Single entity → the entity object itself: `{ "id": "…", "title": "…" }`
- List → `{ "items": […], "nextCursor": "…" | null }` (cursor pagination, `limit` ≤ 100, default 50)
- Error → `{ "code": "NOT_FOUND", "message": "…", "details?": {…}, "traceId": "…" }`

## For AI Agents

When implementing or reviewing response handling, **always** follow these steps:

### Step 1: Check for Raw Row Returns

**Pattern to check:** Look for controllers returning service results that are (or contain) raw Prisma rows, and for manual field exclusion scattered across methods.

```typescript
// ❌ WRONG - Returns Prisma row with passwordHash
@Get(':id')
findOne(@Param('id') id: string) {
  return this.usersService.findById(id); // ❌ row includes passwordHash!
}

// ❌ WRONG - Service queries with no select, returns everything
async findById(id: string) {
  return this.prisma.user.findUnique({ where: { id } }); // ❌ all columns
}

// ❌ WRONG - Manual exclusion in each method
@Get(':id')
async findOne(@Param('id') id: string) {
  const user = await this.usersService.findById(id);
  // ❌ Repeated, error-prone; forgotten in the next endpoint
  const { passwordHash, ...result } = user;
  return result;
}
```

**If found:** apply Steps 2–4 (contract schema + repository `select` + parse at the boundary).

### Step 2: Define the Response Schema in `@nodus/contracts`

**File:** `packages/contracts/src/users/user-response.schema.ts`

The response schema defines exactly what the API may expose. `passwordHash` is simply absent — there is nothing to "exclude" later.

```typescript
// ✅ REQUIRED: response schema lives in contracts, shared front ↔ back
import { z } from 'zod';
import { isoDateTimeSchema } from '../common/iso-date-time.schema';

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(), // подписной относительный путь файла-деривата, НЕ z.url() (#880)
  createdAt: isoDateTimeSchema, // UTC ISO 8601 on the wire (I7)
});

export type UserResponse = z.infer<typeof userResponseSchema>;
```

```typescript
// ✅ File: packages/contracts/src/common/iso-date-time.schema.ts
// Accepts a Date (Prisma row field) or an ISO string, always outputs UTC ISO 8601.
import { z } from 'zod';

export const isoDateTimeSchema = z
  .union([z.date(), z.string().datetime()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));
```

Zod **strips unknown keys by default** during `parse()` — so even if a row accidentally carries an extra column, the parsed response drops it. Treat this as a safety net, not the primary mechanism: the column must not be selected at all (Step 3), because it can still leak into logs, events, or error payloads before serialization.

### Step 3: Select Only Exposed Columns in the Repository

**File:** `apps/api/src/modules/users/users.repository.ts`

The repository is the only place that knows Prisma (patterns.md). Declare the public column set once, next to the queries, and reuse it — the field policy then has a single point of change.

```typescript
// ✅ REQUIRED: sensitive columns are never selected
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Columns safe to expose via API. `passwordHash` is NEVER selected. */
export const userPublicSelect = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: userPublicSelect, // ✅ row type already excludes passwordHash
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: userPublicSelect,
    });
  }
}
```

Because `select` is typed, the returned row type **at compile time** does not contain `passwordHash` — the service layer cannot leak the field even by mistake, and TypeScript will fail the build if someone tries to return it in a DTO.

The authentication use case (you genuinely need the hash to verify a password) gets its own explicitly-named method — never reuse the public select for it:

```typescript
// ✅ Separate, loudly-named method for the credential check only
findWithCredentialsByEmail(email: string) {
  return this.prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true },
  });
}
```

### Step 4: Parse Through the Schema at the Controller Boundary

**File:** `apps/api/src/modules/users/users.controller.ts`

```typescript
// ✅ REQUIRED: controller parses the row through the contract schema
import { Controller, Get, Param } from '@nestjs/common';
import { ErrorCode, userResponseSchema, type UserResponse } from '@nodus/contracts';
import { DomainException } from '../../core/errors/domain-exception';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserResponse> {
    const row = await this.usersService.findById(id);
    if (!row) {
      throw new DomainException(ErrorCode.NOT_FOUND, 'User not found'); // mapped by core filter
    }
    return userResponseSchema.parse(row); // ✅ strips anything unexpected
  }
}
```

Rules for the parse step:

- Parse in the **controller** (HTTP boundary), not in the service — the service stays HTTP-free and returns repository rows; the controller owns the wire format.
- The return type annotation (`Promise<UserResponse>`) plus `parse` keeps handler output and contract in lockstep; a schema change breaks the build everywhere it must.
- The parse cost is negligible next to the database round-trip. Do not skip it "for performance" on hot paths.

### Step 5: Computed Fields — Map Explicitly, Not via Entity Getters

There are no entity classes with getters in this stack. A computed field is produced either by a zod `.transform()` on the schema or by an explicit mapping in the service:

```typescript
// ✅ Option A: derive inside the response schema
export const userResponseSchema = z
  .object({
    id: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email(),
  })
  .transform((row) => ({
    ...row,
    displayName: `${row.firstName} ${row.lastName}`.trim(),
  }));

// ✅ Option B: map in the service when the derivation needs other data
async findAssigneeSummary(taskId: string) {
  const row = await this.usersRepository.findById(taskId);
  return {
    ...row,
    openTaskCount: await this.tasksRepository.countOpenByAssignee(row.id),
  };
}
```

Keep derivations pure and cheap. Anything expensive (aggregations over many rows) belongs in the repository query, not in a per-item transform over a 100-item page.

### Step 6: Role-Based Responses — Separate Schemas per Audience

`class-transformer` groups do not exist here. Model each audience as its own schema (and its own repository select), then pick the schema by the caller's role — RBAC is enforced by API guards (I8), the controller just chooses the serialization:

```typescript
// ✅ File: packages/contracts/src/users/user-response.schema.ts
export const userPublicResponseSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(), // подписной относительный путь файла-деривата, НЕ z.url() (#880)
});

export const userSelfResponseSchema = userPublicResponseSchema.extend({
  email: z.string().email(),
  phone: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});

export const userAdminResponseSchema = userSelfResponseSchema.extend({
  lastLoginAt: isoDateTimeSchema.nullable(),
  deactivatedAt: isoDateTimeSchema.nullable(),
});

export type UserPublicResponse = z.infer<typeof userPublicResponseSchema>;
export type UserSelfResponse = z.infer<typeof userSelfResponseSchema>;
export type UserAdminResponse = z.infer<typeof userAdminResponseSchema>;
```

```typescript
// ✅ Controller chooses schema by caller; guard has already enforced access
@Get(':id')
async findOne(
  @Param('id') id: string,
  @GetUser() caller: AuthUser,
): Promise<UserPublicResponse | UserSelfResponse> {
  const row = await this.usersService.findById(id);
  if (!row) throw new DomainException(ErrorCode.NOT_FOUND, 'User not found');

  return caller.id === row.id
    ? userSelfResponseSchema.parse(row)   // full profile for own account
    : userPublicResponseSchema.parse(row); // minimal card for colleagues
}

@Get('admin/:id')
@RequirePermissions(Permission.USER_MANAGE) // core permission guard — enforced at API level, not only in UI (I8)
async adminFindOne(@Param('id') id: string): Promise<UserAdminResponse> {
  const row = await this.usersService.findById(id);
  if (!row) throw new DomainException(ErrorCode.NOT_FOUND, 'User not found');
  return userAdminResponseSchema.parse(row);
}
```

Mirror the same split in the repository (`userPublicSelect`, `userSelfSelect`, `userAdminSelect`) so each audience reads exactly the columns its schema exposes.

### Step 7: Keep the Response Format Invariants

Re-check every endpoint against the fixed shapes:

```typescript
// ❌ FORBIDDEN - success envelope
return { success: true, data: user, timestamp: new Date().toISOString() };

// ❌ FORBIDDEN - home-grown error shape
return { error: 'not found', status: 404 };

// ✅ CORRECT - entity endpoint returns the parsed entity
return userResponseSchema.parse(row);

// ✅ CORRECT - list endpoint returns cursor page
return { items: rows.map((r) => taskResponseSchema.parse(r)), nextCursor };

// ✅ CORRECT - errors are thrown as domain exceptions with contract codes;
//    the core exception filter renders { code, message, details?, traceId }
throw new DomainException(ErrorCode.NOT_FOUND, 'User not found');
```

## Quick Reference Checklist

Use this checklist when reviewing or creating endpoints:

- [ ] No controller returns a raw Prisma row or a repository result unparsed
- [ ] Every endpoint has a response schema in `packages/contracts`
- [ ] Repository queries use an explicit `select` without sensitive columns
- [ ] Credential-bearing queries are separate, loudly-named repository methods
- [ ] No success envelope (`success`, `data`, `timestamp`) anywhere
- [ ] Errors are domain exceptions with contract codes, rendered by the core filter
- [ ] Lists return `{ items, nextCursor }` with deterministic ordering
- [ ] Role-based audiences use separate schemas, not ad-hoc field deletion
- [ ] Dates leave the API as UTC ISO 8601 strings

**Incorrect:**

```typescript
// users/users.controller.ts - Leaks sensitive data 🚨
import { Controller, Get, Param } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // ❌ Returns row with passwordHash field
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    // Response includes: { id, email, displayName, passwordHash, internalNotes }
    return user;
  }

  // ❌ Manual exclusion - verbose and error-prone
  @Get('public/:id')
  async findPublic(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    // ❌ Must remember to exclude in every method, forever
    const { passwordHash, internalNotes, ...publicUser } = user;
    return publicUser;
  }

  // ❌ Success envelope - forbidden by api-conventions
  @Get()
  async findAll() {
    const users = await this.usersService.findAll();
    return { success: true, data: users };
  }
}

// users/users.repository.ts - No column policy 🚨
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    // ❌ SELECT * — every column, including passwordHash, crosses layers
    return this.prisma.user.findUnique({ where: { id } });
  }
}
```

**Correct:**

```typescript
// packages/contracts/src/users/user-response.schema.ts ✅
import { z } from 'zod';
import { isoDateTimeSchema } from '../common/iso-date-time.schema';

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(), // подписной относительный путь файла-деривата, НЕ z.url() (#880)
  createdAt: isoDateTimeSchema,
});

export type UserResponse = z.infer<typeof userResponseSchema>;

// users/users.repository.ts - Explicit column policy ✅
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

export const userPublicSelect = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: userPublicSelect, // ✅ passwordHash never leaves the database
    });
  }
}

// users/users.controller.ts - Parse at the boundary ✅
import { Controller, Get, Param } from '@nestjs/common';
import { ErrorCode, userResponseSchema, type UserResponse } from '@nodus/contracts';
import { DomainException } from '../../core/errors/domain-exception';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserResponse> {
    const row = await this.usersService.findById(id);
    if (!row) throw new DomainException(ErrorCode.NOT_FOUND, 'User not found');
    return userResponseSchema.parse(row); // ✅ consistent shape, stripped extras
  }

  @Get()
  async findAll(@Query() query: CursorQueryDto) {
    const page = await this.usersService.findPage(query);
    return {
      items: page.items.map((row) => userResponseSchema.parse(row)), // ✅
      nextCursor: page.nextCursor,
    };
  }
}
```

## Advanced: Serializing Lists and Cursor Pages

A tiny shared helper keeps list endpoints uniform. It belongs in core (`apps/api/src/common/`), not in each module:

```typescript
// ✅ File: apps/api/src/common/serialize-page.ts
import { z } from 'zod';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Parses every item of a cursor page through the contract schema. */
export function serializePage<S extends z.ZodTypeAny>(
  schema: S,
  page: CursorPage<unknown>,
): CursorPage<z.output<S>> {
  return {
    items: page.items.map((item) => schema.parse(item)),
    nextCursor: page.nextCursor,
  };
}
```

```typescript
// ✅ Usage in a controller
@Get()
async findAll(@Query() query: CursorQueryDto) {
  const page = await this.tasksService.findPage(query);
  return serializePage(taskResponseSchema, page);
}
```

Do **not** build a global interceptor that auto-detects "paginated-looking" objects and transforms them — implicit serialization hides the contract from the reader and from the OpenAPI generator. Explicit `parse` / `serializePage` at the boundary is the pattern; the response schema is also what feeds the OpenAPI annotations.

## Advanced: Testing the Serialization Boundary

The security property ("sensitive fields never leave the API") deserves a deterministic unit test next to the code (Vitest, AAA):

```typescript
// ✅ File: apps/api/src/modules/users/users.controller.test.ts
import { describe, expect, it, vi } from 'vitest';
import { DomainException } from '../../core/errors/domain-exception';
import { UsersController } from './users.controller';

const row = {
  id: '3f6b0e6e-9b1a-4d3c-9d3f-2c6f0a1b2c3d',
  email: 'ivanov@nodus.by',
  displayName: 'Иван Иванов',
  avatarUrl: null,
  createdAt: new Date('2026-01-20T12:00:00.000Z'),
};

function makeController(rowOrNull: typeof row | null) {
  const service = { findById: vi.fn().mockResolvedValue(rowOrNull) };
  // @ts-expect-error - minimal service stub for the boundary test
  return new UsersController(service);
}

describe('UsersController response boundary', () => {
  it('serializes dates to UTC ISO 8601 strings', async () => {
    const result = await makeController(row).findOne(row.id);
    expect(result.createdAt).toBe('2026-01-20T12:00:00.000Z');
  });

  it('strips fields that are not in the contract schema', async () => {
    const controller = makeController({ ...row, passwordHash: 'x' } as never);
    const result = await controller.findOne(row.id);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('throws a not-found domain exception for a missing user', async () => {
    await expect(makeController(null).findOne(row.id)).rejects.toThrow(
      DomainException,
    );
  });
});
```

A second layer of protection is a repository-level test asserting the `select` object itself never regains a sensitive key:

```typescript
// ✅ File: apps/api/src/modules/users/users.repository.test.ts
import { describe, expect, it } from 'vitest';
import { userPublicSelect } from './users.repository';

describe('userPublicSelect', () => {
  it('never selects credential or internal columns', () => {
    expect(userPublicSelect).not.toHaveProperty('passwordHash');
    expect(userPublicSelect).not.toHaveProperty('internalNotes');
  });
});
```

## Advanced: What Replaces the Wrapper Interceptor

Cross-cutting concerns that other stacks stuff into response interceptors are handled by dedicated core mechanisms here — do not reinvent them per module:

| Concern | Mechanism |
|---|---|
| Error shape `{ code, message, details?, traceId }` | Core global exception filter (see `error-handling-exception-filter`) |
| `traceId` correlation | Core logging interceptor, request id from Fastify |
| Audit of user actions | Core audit interceptor (I7) |
| Idempotent mutations | Core idempotency interceptor (`Idempotency-Key`) |
| Response field policy | Contract schema + repository `select` (this rule) |

## Best Practices Summary

| Practice | Why |
|----------|-----|
| Response schemas in `@nodus/contracts` | One wire contract shared by backend, frontend, and OpenAPI |
| `select` without sensitive columns in the repository | Leak becomes impossible at compile time, not just by convention |
| `parse` at the controller boundary | Strips unexpected keys; keeps handlers and contract in lockstep |
| Separate schemas per audience | Role-based exposure without fragile manual deletion |
| No success envelope | Fixed response shapes per api-conventions; less payload noise |
| Domain exceptions + core filter | Uniform `{ code, message, details?, traceId }` errors everywhere |
| Boundary tests next to the code | Regression-proof the "no sensitive field" property |
