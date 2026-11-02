import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { expect } from 'vitest';
import {
  conversationListItemSchema,
  paginatedSchema,
  type ConversationListItem,
  type Paginated,
} from '@nodus/contracts';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/core/database/prisma.service.js';
import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { registerCoreFastifyPlugins } from '../../src/core/http/register-fastify-plugins.js';
import { REDIS_CLIENT } from '../../src/core/redis/redis.module.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { quiesceOutbox } from './outbox-test-utils.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * Общая фикстура интеграционных тестов модуля chat (#58): живое приложение
 * (AppModule: гварды, идемпотентность, аудит, outbox) на реальных PG/Redis,
 * тестовые пользователи без паролей (access-JWT минтится TokenService напрямую,
 * верификация stateless) и полная уборка своих данных после прогона.
 */

/** Имена фикстурных пользователей (displayName уникален на прогон — поиск). */
const FIRST_NAME: Record<string, string> = {
  alice: 'Алиса',
  bob: 'Борис',
  carol: 'Вера',
  dave: 'Дмитрий',
  eve: 'Ева',
};

const USER_EMAIL_PREFIX = 'chat-it-';

export interface ChatUser {
  id: string;
  email: string;
  displayName: string;
  token: string;
}

export interface ChatTestFixture<T extends string = string> {
  runId: string;
  app: NestFastifyApplication;
  prisma: PrismaService;
  redis: Redis;
  baseUrl: string;
  users: Record<T, ChatUser>;
  /** HTTP-вызов от имени пользователя (Bearer-токен фикстуры). */
  api(
    user: ChatUser,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    opts?: { body?: unknown; key?: string },
  ): Promise<Response>;
  /** Список бесед пользователя (контракт paginated(conversationListItem)). */
  listConversations(user: ChatUser): Promise<Paginated<ConversationListItem>>;
  /** Уборка: беседы/сообщения/события/аудит/пользователи прогона. */
  cleanup(): Promise<void>;
}

/** Удаление всех данных, созданных тестовыми пользователями (порядок важен). */
async function deleteUserData(prisma: PrismaService, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { createdBy: { in: userIds } },
        { userMin: { in: userIds } },
        { userMax: { in: userIds } },
      ],
    },
    select: { id: true },
  });
  const ids = conversations.map((c) => c.id);
  if (ids.length > 0) {
    // Само-ссылки сообщений (reply/thread, ON DELETE RESTRICT) разрываем до
    // каскадного удаления беседы, иначе FK не даст удалить ответы.
    await prisma.$executeRaw`UPDATE messages SET reply_to_id = NULL, thread_root_id = NULL
      WHERE conversation_id = ANY(${ids}::uuid[])`;
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    // События не имеют FK на беседу — вычищаем по aggregate (outbox-лог I9).
    await prisma.event.deleteMany({
      where: { aggregateType: 'conversation', aggregateId: { in: ids } },
    });
  }
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

export async function setupChatFixture<T extends string>(
  tags: readonly T[],
): Promise<ChatTestFixture<T>> {
  const url = await ensureTestDatabase(`${__dirname}/../..`);
  process.env.DATABASE_URL = url;

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  // Сквозные плагины — та же точка, что и main.ts (cookie, multipart #57).
  await registerCoreFastifyPlugins(app);
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const prisma = app.get(PrismaService);
  const redis = app.get<Redis>(REDIS_CLIENT);
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  // Фичефлаг chat (I10): без флага маршруты модуля отвечают 404 как отсутствующие.
  await prisma.featureFlag.upsert({
    where: { key: 'chat' },
    update: { enabled: true },
    create: { key: 'chat', enabled: true },
  });
  // Уведомления (#100) — тот же закон: фикстура включает флаг модуля.
  await prisma.featureFlag.upsert({
    where: { key: 'notifications' },
    update: { enabled: true },
    create: { key: 'notifications', enabled: true },
  });

  // Хвосты упавших прошлых прогонов (файлы идут последовательно — гонки нет).
  const abandoned = await prisma.user.findMany({
    where: { email: { startsWith: USER_EMAIL_PREFIX } },
    select: { id: true },
  });
  await deleteUserData(
    prisma,
    abandoned.map((u) => u.id),
  );

  const runId = crypto.randomUUID().slice(0, 8);
  const tokenService = app.get(TokenService);
  const users = {} as Record<T, ChatUser>;
  const userIds: string[] = [];
  for (const tag of tags) {
    const firstName = FIRST_NAME[tag] ?? tag;
    const row = await prisma.user.create({
      data: {
        email: `${USER_EMAIL_PREFIX}${runId}-${tag}@test.nodus.local`,
        passwordHash: 'integration-test-no-login',
        lastName: `Чатов${runId}`,
        firstName,
        displayName: `Чатов${runId} ${firstName}`,
      },
      select: { id: true, email: true, displayName: true },
    });
    userIds.push(row.id);
    // Пароль не нужен: access-JWT stateless, сессия не проверяется (jwt-auth.guard).
    const token = await tokenService.signAccessToken(
      { id: row.id, email: row.email, displayName: row.displayName, permissions: [] },
      'integration-test-session',
    );
    users[tag] = { ...row, token };
  }

  const fixture: ChatTestFixture = {
    runId,
    app,
    prisma,
    redis,
    baseUrl,
    users,
    async api(user, method, path, opts = {}) {
      const headers: Record<string, string> = { authorization: `Bearer ${user.token}` };
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      if (opts.key !== undefined) headers['idempotency-key'] = opts.key;
      return fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    },
    async listConversations(user) {
      const res = await fixture.api(user, 'GET', '/chat/conversations?limit=100');
      expect(res.status).toBe(200);
      return paginatedSchema(conversationListItemSchema).parse(await res.json());
    },
    async cleanup() {
      try {
        // #528: до удаления данных гасим фоновый outbox — иначе поздние
        // подписчики пишут проекции в уже убранные строки (FK на teardown).
        await quiesceOutbox(app.get(EventDispatcher));
        // Sweep по пользователям покрывает все беседы прогона (создатель direct/group).
        await deleteUserData(prisma, userIds);
      } finally {
        await app.close();
      }
    },
  };
  return fixture;
}
