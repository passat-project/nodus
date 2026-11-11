import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Личные настройки интерфейса (#745) на живом HTTP: субъект всегда берётся из
 * токена, чужой id не подставить. Критерий приёмки — A не читает и не пишет
 * prefs B; PUT A не меняет слой B. БД — тестовая (`setupChatFixture`),
 * фикстура даёт два независимых пользователя и HTTP-клиент с Bearer.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'preferences: изоляция личных настроек (integration)',
  () => {
    let fx: ChatTestFixture<'alice' | 'bob'>;
    let alice: ChatUser;
    let bob: ChatUser;

    beforeAll(async () => {
      fx = await setupChatFixture(['alice', 'bob']);
      ({ alice, bob } = fx.users);
    }, 120_000);

    afterAll(async () => {
      if (fx) {
        await fx.prisma.userPreference.deleteMany({
          where: { userId: { in: [alice.id, bob.id] } },
        });
        await fx.cleanup();
      }
    });

    async function getPrefs(user: ChatUser) {
      const res = await fx.api(user, 'GET', '/me/preferences');
      expect(res.status).toBe(200);
      return (await res.json()) as {
        preferences: { navOrder?: string[] };
        updatedAt: string;
      };
    }

    it('A пишет свои — B видит пустые, обратная запись A не перетирает', async () => {
      const putA = await fx.api(alice, 'PUT', '/me/preferences', {
        body: { preferences: { navOrder: ['home', 'tasks'] } },
        key: `prefs-a-${fx.runId}`,
      });
      expect(putA.status).toBe(200);

      expect((await getPrefs(alice)).preferences.navOrder).toEqual(['home', 'tasks']);
      expect((await getPrefs(bob)).preferences.navOrder).toBeUndefined();

      const putB = await fx.api(bob, 'PUT', '/me/preferences', {
        body: { preferences: { navOrder: ['letters'] } },
        key: `prefs-b-${fx.runId}`,
      });
      expect(putB.status).toBe(200);

      expect((await getPrefs(alice)).preferences.navOrder).toEqual(['home', 'tasks']);
      expect((await getPrefs(bob)).preferences.navOrder).toEqual(['letters']);
    });

    it('чужие prefs не подставляются ни query, ни телом', async () => {
      const viaQuery = await fx.api(alice, 'GET', `/me/preferences?userId=${bob.id}`);
      expect(viaQuery.status).toBe(200);
      expect(
        ((await viaQuery.json()) as { preferences: { navOrder?: string[] } }).preferences.navOrder,
      ).toEqual(['home', 'tasks']);

      const viaBody = await fx.api(alice, 'PUT', '/me/preferences', {
        body: { userId: bob.id, preferences: { navOrder: ['bob-hijack'] } },
        key: `prefs-hijack-${fx.runId}`,
      });
      expect(viaBody.status).toBe(200);
      expect((await getPrefs(bob)).preferences.navOrder).toEqual(['letters']);
    });
  },
);
