import 'reflect-metadata';
import { execSync } from 'node:child_process';
import fastifyCookie, { type FastifyCookieOptions } from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyPluginCallback } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  apiErrorResponseSchema,
  authTokensSchema,
  authUserSchema,
  departmentNodeSchema,
  ErrorCode,
  paginatedSchema,
  userCardSchema,
  userListItemSchema,
} from '@nodus/contracts';

import type { Redis } from 'ioredis';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/core/database/prisma.service.js';
import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { REDIS_CLIENT } from '../../src/core/redis/redis.module.js';
import { waitForAudit } from './audit-test-utils.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * Критерии приёмки issue #3 на живом стеке (реальные PG/Redis, nodus_test):
 * логин → refresh-ротация → reuse-detection → logout; RBAC на уровне API (I8);
 * деактивация пользователя отзывает сессии и действующие access-токены
 * событием directory.user.deactivated (стоп-лист Redis, #333).
 */

// Креды тестового стенда (nodus_test): сид запускается с ними же ниже —
// дефолты сида случайные (пароли прода больше не известны из git).
// EMPLOYEE — pilot-учётка роли employee из сида (BIM-мастер).
const ADMIN = {
  email: 'admin@nodus.by',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'test-admin-password',
};
const EMPLOYEE = {
  email: 'a.voronich@passatproekt.by',
  password: process.env.SEED_DEMO_PASSWORD ?? 'test-demo-password',
};

function cookieOf(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0]!;
}

async function login(baseUrl: string, email: string, password: string): Promise<Response> {
  return fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('auth + directory (integration)', () => {
  let app: NestFastifyApplication;
  let baseUrl: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    const testUrl = await ensureTestDatabase(process.cwd());
    process.env.DATABASE_URL = testUrl;
    // Демо-данные в тестовую БД (идемпотентный seed; пароли передаём явно —
    // сид обновляет их у существующих записей, прогоны стабильны на любой БД).
    execSync('pnpm exec prisma db seed', {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: testUrl,
        SEED_ADMIN_PASSWORD: ADMIN.password,
        SEED_DEMO_PASSWORD: EMPLOYEE.password,
      },
      stdio: 'inherit',
    });

    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.register(fastifyCookie as FastifyPluginCallback<FastifyCookieOptions>);
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    prisma = app.get(PrismaService);
    // Повторные прогоны на той же БД: сбрасываем статусы после прошлых тестов.
    await prisma.user.updateMany({ data: { status: 'active' } });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('неверный пароль → 401 AUTH_INVALID_CREDENTIALS + аудит login_failed', async () => {
    const res = await login(baseUrl, ADMIN.email, 'wrong-password');
    expect(res.status).toBe(401);
    const body = apiErrorResponseSchema.parse(await res.json());
    expect(body.code).toBe(ErrorCode.AUTH_INVALID_CREDENTIALS);

    const audit = await waitForAudit(() =>
      prisma.auditLog.findFirst({
        where: { action: 'auth.login_failed', details: { path: ['email'], equals: ADMIN.email } },
      }),
    );
    expect(audit.action).toBe('auth.login_failed');
  });

  it('запрос без токена → 401 UNAUTHENTICATED (default-deny)', async () => {
    const res = await fetch(`${baseUrl}/directory/users`);
    expect(res.status).toBe(401);
    expect(apiErrorResponseSchema.parse(await res.json()).code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('сотрудник без права directory.manage → 403 FORBIDDEN на мутации (I8)', async () => {
    const res = await login(baseUrl, EMPLOYEE.email, EMPLOYEE.password);
    expect(res.status).toBe(200);
    const { accessToken } = authTokensSchema.parse(await res.json());

    // Чтение справочника разрешено (directory.read у роли employee).
    const list = await fetch(`${baseUrl}/directory/users?limit=5`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(list.status).toBe(200);

    // Создание пользователя — запрещено.
    const create = await fetch(`${baseUrl}/directory/users`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'hack@nodus.by',
        password: 'Start!23456789',
        lastName: 'Хакер',
        firstName: 'Тест',
      }),
    });
    expect(create.status).toBe(403);
    expect(apiErrorResponseSchema.parse(await create.json()).code).toBe(ErrorCode.FORBIDDEN);
  });

  it('полный цикл: login → me → refresh-ротация → reuse → logout', async () => {
    // login
    const loginRes = await login(baseUrl, ADMIN.email, ADMIN.password);
    expect(loginRes.status).toBe(200);
    const tokens = authTokensSchema.parse(await loginRes.json());
    const cookie = cookieOf(loginRes);
    expect(cookie).toMatch(/^nodus_refresh=/);

    // me
    const me = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.status).toBe(200);
    expect(authUserSchema.parse(await me.json()).email).toBe(ADMIN.email);

    // refresh: ротация выдаёт новый refresh (cookie обязана смениться);
    // access-JWT детерминирован для того же payload в ту же секунду — не сравниваем.
    const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(refreshRes.status).toBe(200);
    const rotated = authTokensSchema.parse(await refreshRes.json());
    const newCookie = cookieOf(refreshRes);
    expect(rotated.accessToken).toBeTruthy();
    expect(newCookie).not.toBe(cookie);

    // Мгновенное переиспользование СТАРОГО токена = гонка (мультитаб/ретрай):
    // leeway-окно принимает и ротирует штатно — НЕ отзыв.
    const raceRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(raceRes.status).toBe(200);
    const afterRaceCookie = cookieOf(raceRes);

    // Кража: предыдущий токен предъявлен ПОЗЖЕ leeway-окна (симулируем —
    // отматываем updatedAt сессии на минуту назад) → отзыв всей цепочки.
    const sessionId = afterRaceCookie.slice('nodus_refresh='.length).split('.')[0]!;
    await prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date(Date.now() - 60_000) },
    });
    const theftRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: newCookie }, // newCookie — теперь «предыдущий»
    });
    expect(theftRes.status).toBe(401);
    expect(apiErrorResponseSchema.parse(await theftRes.json()).code).toBe(
      ErrorCode.AUTH_SESSION_INVALID,
    );
    const revoked = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(revoked?.revokedAt).not.toBeNull();

    // Вся цепочка мертва, включая последний выданный токен
    const afterRevoke = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: afterRaceCookie },
    });
    expect(afterRevoke.status).toBe(401);

    // заново login → logout → refresh мёртв
    const relogin = await login(baseUrl, ADMIN.email, ADMIN.password);
    const reloginCookie = cookieOf(relogin);
    const logout = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie: reloginCookie },
    });
    expect(logout.status).toBe(204);
    const afterLogout = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: reloginCookie },
    });
    expect(afterLogout.status).toBe(401);
  });

  it('email без учёта регистра (#321): логин в другом регистре, дубль — 409, БД хранит нижний', async () => {
    const shouted = await login(baseUrl, `  ${ADMIN.email.toUpperCase()} `, ADMIN.password);
    expect(shouted.status).toBe(200);
    const { accessToken } = authTokensSchema.parse(await shouted.json());

    const email = `case-it-${crypto.randomUUID().slice(0, 8)}@test.nodus.local`;
    const create = (address: string) =>
      fetch(`${baseUrl}/directory/users`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          email: address,
          password: 'Start!23456789',
          lastName: 'Регистров',
          firstName: 'Тест',
        }),
      });
    const first = await create(` ${email.toUpperCase()}`);
    expect(first.status).toBe(201);
    const card = userCardSchema.parse(await first.json());
    try {
      expect(card.email).toBe(email);
      const dup = await create(email);
      expect(dup.status).toBe(409);
      expect(apiErrorResponseSchema.parse(await dup.json()).code).toBe(
        ErrorCode.DIRECTORY_EMAIL_TAKEN,
      );
      // Гарантия БД: мимо контракта ненормализованный адрес не записать.
      await expect(
        prisma.user.update({ where: { id: card.id }, data: { email: email.toUpperCase() } }),
      ).rejects.toThrow();
    } finally {
      await prisma.user.delete({ where: { id: card.id } });
    }
  });

  it('деактивация пользователя отзывает его сессии событием', async () => {
    // Сессия сотрудника
    const employeeLogin = await login(baseUrl, EMPLOYEE.email, EMPLOYEE.password);
    const employeeCookie = cookieOf(employeeLogin);
    const employeeTokens = authTokensSchema.parse(await employeeLogin.json());

    // Админ деактивирует сотрудника
    const adminLogin = await login(baseUrl, ADMIN.email, ADMIN.password);
    const adminTokens = authTokensSchema.parse(await adminLogin.json());
    const list = await fetch(`${baseUrl}/directory/users?search=Воронич`, {
      headers: { authorization: `Bearer ${adminTokens.accessToken}` },
    });
    const { items } = paginatedSchema(userListItemSchema).parse(await list.json());
    const target = items.find((u) => u.email === EMPLOYEE.email);
    const deactivate = await fetch(`${baseUrl}/directory/users/${target!.id}/deactivate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminTokens.accessToken}` },
    });
    expect(deactivate.status).toBe(200);
    const deactivatedCard = userCardSchema.parse(await deactivate.json());

    // Диспетчер доставляет directory.user.deactivated → auth отзывает сессии
    // и ставит стоп-лист access-токенов (#333): старый, ещё не истёкший access
    // отвергается произвольным эндпоинтом именно стоп-листом (не подписью/сроком).
    await app.get(EventDispatcher).dispatchPending();
    const revoked = await fetch(`${baseUrl}/home/summary`, {
      headers: { authorization: `Bearer ${employeeTokens.accessToken}` },
    });
    expect(revoked.status).toBe(401);
    const revokedError = apiErrorResponseSchema.parse(await revoked.json());
    expect(revokedError.code).toBe(ErrorCode.UNAUTHENTICATED);
    expect(revokedError.message).toBe('Access token revoked');

    const refresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: employeeCookie },
    });
    expect(refresh.status).toBe(401);

    // Повторный логин деактивированного — 401
    const reLogin = await login(baseUrl, EMPLOYEE.email, EMPLOYEE.password);
    expect(reLogin.status).toBe(401);

    // /me перечитывает статус из БД → 401 сразу (и стоп-лист — тоже).
    const meWithOldToken = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${employeeTokens.accessToken}` },
    });
    expect(meWithOldToken.status).toBe(401);

    // Возврат в работу (AUD-016): статус снимается, роли сохраняются,
    // сотрудник входит заново. Повтор активации идемпотентен.
    const activate = await fetch(`${baseUrl}/directory/users/${target!.id}/activate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminTokens.accessToken}` },
    });
    expect(activate.status).toBe(200);
    const activated = userCardSchema.parse(await activate.json());
    expect(activated.status).toBe('active');
    expect(activated.roles).toEqual(deactivatedCard.roles);
    const repeated = await fetch(`${baseUrl}/directory/users/${target!.id}/activate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminTokens.accessToken}` },
    });
    expect(repeated.status).toBe(200);
    expect(userCardSchema.parse(await repeated.json()).status).toBe('active');

    // Стоп-лист деактивации в жизни истекает задолго до возврата; в тесте
    // время не ждём — снимаем запись, как клиент после refresh.
    await app.get<Redis>(REDIS_CLIENT).del(`nodus:auth:revoked-before:${target!.id}`);
    const back = await login(baseUrl, EMPLOYEE.email, EMPLOYEE.password);
    expect(back.status).toBe(200);
    const backTokens = authTokensSchema.parse(await back.json());
    const meAfterActivation = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${backTokens.accessToken}` },
    });
    expect(meAfterActivation.status).toBe(200);
  });

  it('админ видит дерево оргструктуры с руководителями', async () => {
    const adminLogin = await login(baseUrl, ADMIN.email, ADMIN.password);
    const { accessToken } = authTokensSchema.parse(await adminLogin.json());

    const tree = await fetch(`${baseUrl}/directory/departments/tree`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(tree.status).toBe(200);
    const roots = z.array(departmentNodeSchema).parse(await tree.json());
    expect(roots).toHaveLength(1);
    expect(roots[0]!.name).toBe('ПассатПроект');
    // Единственная пилотная группа — прямой ребёнок компании, с руководителем.
    const bim = roots[0]!.children.find((c) => c.name === 'Группа BIM-технологий');
    expect(bim).toBeDefined();
    expect(bim!.headName).toContain('Климович');

    // Юридическая структура на пилоте не сеется — дерево пусто.
    const legal = await fetch(`${baseUrl}/directory/departments/tree?kind=legal`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const legalRoots = z.array(departmentNodeSchema).parse(await legal.json());
    expect(legalRoots).toHaveLength(0);
  });
});
