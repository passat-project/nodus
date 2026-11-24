import 'reflect-metadata';
import { execSync } from 'node:child_process';
import fastifyCookie, { type FastifyCookieOptions } from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyPluginCallback } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/core/database/prisma.service.js';
import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { InvitationExpiryJob } from '../../src/modules/directory/invitation-expiry.job.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * Приглашение по ссылке (#101) на живых PG/Redis: одноразовость под гонкой
 * (два параллельных accept), автоистечение (удаление новой строки vs возврат
 * «Уволен»), отзыв сессий по событию сброса пароля.
 */

const ADMIN = {
  email: 'admin@nodus.by',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'test-admin-password',
};
const PASSWORD = 'Night-Probe-100!';

interface Json {
  [key: string]: unknown;
}

describe('приглашения (integration, #101)', () => {
  let app: NestFastifyApplication;
  let baseUrl: string;
  let prisma: PrismaService;
  let dispatcher: EventDispatcher;
  let expiry: InvitationExpiryJob;
  let adminToken: string;
  let positionId: string;
  let departmentId: string;

  async function api(path: string, init: RequestInit = {}, token = adminToken): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.method && init.method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  async function createInvitation(email: string): Promise<{ id: string; token: string }> {
    const response = await api('/directory/invitations', {
      method: 'POST',
      body: JSON.stringify({
        email,
        lastName: 'Приглашённый',
        firstName: 'Тест',
        middleName: null,
        positionId,
        departmentId,
      }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; token: string };
  }

  async function accept(token: string, email: string): Promise<Response> {
    return fetch(`${baseUrl}/invitations/${token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
  }

  beforeAll(async () => {
    const testUrl = await ensureTestDatabase(process.cwd());
    process.env.DATABASE_URL = testUrl;
    execSync('pnpm exec prisma db seed', {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: testUrl,
        SEED_ADMIN_PASSWORD: ADMIN.password,
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
    dispatcher = app.get(EventDispatcher);
    expiry = app.get(InvitationExpiryJob);

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ADMIN),
    });
    expect(login.ok).toBeTruthy();
    adminToken = ((await login.json()) as { accessToken: string }).accessToken;

    const positions = (await (await api('/directory/positions?kind=management')).json()) as Json[];
    const departments = (await (
      await api('/directory/departments/tree?kind=management')
    ).json()) as Json[];
    positionId = String(positions[0]?.id);
    departmentId = String(departments[0]?.id);
    expect(positionId).toBeTruthy();
    expect(departmentId).toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('два параллельных accept: ровно один выигрывает (CAS, одноразовость)', async () => {
    const email = `race.${Date.now()}@nodus.local`;
    const invitation = await createInvitation(email);

    const [first, second] = await Promise.all([
      accept(invitation.token, email),
      accept(invitation.token, email),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const failed = first.status === 409 ? first : second;
    expect(((await failed.json()) as Json).code).toBe('INVITATION_ALREADY_USED');
  }, 60_000);

  it('истечение: никогда не активированную строку удаляет, бывшего сотрудника — «Уволен»', async () => {
    const freshEmail = `expire-new.${Date.now()}@nodus.local`;
    const fresh = await createInvitation(freshEmail);
    await prisma.userToken.updateMany({
      where: { userId: fresh.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const formerEmail = `expire-former.${Date.now()}@nodus.local`;
    const former = await createInvitation(formerEmail);
    expect((await accept(former.token, formerEmail)).ok).toBe(true);
    // Активация индексирует сотрудника (событие user.activated): документ есть.
    await dispatcher.dispatchPending();
    expect(
      await prisma.searchDocument.findUnique({
        where: { sourceType_sourceId: { sourceType: 'employee', sourceId: former.id } },
      }),
    ).not.toBeNull();
    // Строка «бывшего сотрудника» вернулась в приглашение (повторный вход):
    // activatedAt сохраняется, поэтому истечение обязано вернуть «Уволен».
    await prisma.user.update({ where: { id: former.id }, data: { status: 'invited' } });

    await expiry.runOnce();
    await dispatcher.dispatchPending();

    expect(await prisma.user.findUnique({ where: { id: fresh.id } })).toBeNull();
    const formerRow = await prisma.user.findUnique({ where: { id: former.id } });
    expect(formerRow?.status).toBe('deactivated');
    expect(formerRow?.activatedAt).not.toBeNull();
    // Поиск: уволенный — tombstone, документа больше нет.
    expect(
      await prisma.searchDocument.findUnique({
        where: { sourceType_sourceId: { sourceType: 'employee', sourceId: former.id } },
      }),
    ).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'directory.invitation.expire', entityId: fresh.id },
    });
    expect(audit?.actorId).toBeNull();
  }, 60_000);

  it('сброс пароля: сессии до события погашены, старый access-токен в стоп-листе', async () => {
    const email = `reset.${Date.now()}@nodus.local`;
    const invitation = await createInvitation(email);
    expect((await accept(invitation.token, email)).ok).toBe(true);

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.ok).toBe(true);
    const session = await prisma.session.findFirst({ where: { user: { email } } });
    expect(session?.revokedAt).toBeNull();

    const reset = await api(`/directory/users/${invitation.id}/password-reset`, { method: 'POST' });
    expect(reset.ok).toBe(true);
    await dispatcher.dispatchPending();

    const after = await prisma.session.findUnique({ where: { id: session!.id } });
    expect(after?.revokedAt).not.toBeNull();
  }, 60_000);
});
