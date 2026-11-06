import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Permission,
  customFieldDefinitionSchema,
  customFieldUsageSchema,
  letterDetailSchema,
} from '@nodus/contracts';

import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import {
  setupCorrespondenceFixture,
  type CorrespondenceFixture,
} from './correspondence-fixtures.js';

/**
 * #575: usage атрибута письма считает значения из `letters.custom_fields`
 * (владелец — correspondence) и не считает надгробия спама.
 */
const FILE = { name: 'scan.pdf', mime: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) };

describe.skipIf(!process.env.DATABASE_URL)(
  'custom fields: usage атрибута письма (integration, #575)',
  () => {
    let c: CorrespondenceFixture;

    beforeAll(async () => {
      c = await setupCorrespondenceFixture();
    }, 180_000);

    afterAll(async () => {
      await c?.cleanup();
    });

    async function newLetter(): Promise<string> {
      const res = await c.createLetter(c.registrar, [FILE]);
      expect(res.status, await res.clone().text()).toBe(201);
      return letterDetailSchema.parse(await res.json()).id;
    }

    async function adminActor() {
      const tokens = c.fx.app.get(TokenService);
      return {
        ...c.registrar,
        token: await tokens.signAccessToken(
          {
            id: c.registrar.id,
            email: c.registrar.email,
            displayName: c.registrar.displayName,
            permissions: [Permission.CUSTOM_FIELD_MANAGE],
          },
          'integration-test-session',
        ),
      };
    }

    it('считает и мягко удалённые письма (уборка стирает их значения); очистка живого уменьшает счётчик', async () => {
      const tokens = c.fx.app.get(TokenService);
      const admin = {
        ...c.registrar,
        token: await tokens.signAccessToken(
          {
            id: c.registrar.id,
            email: c.registrar.email,
            displayName: c.registrar.displayName,
            permissions: [Permission.CUSTOM_FIELD_MANAGE],
          },
          'integration-test-session',
        ),
      };
      const created = await c.api(admin, 'POST', '/custom-fields/definitions', {
        body: {
          type: 'text',
          name: `Проба ${c.fx.runId} письмо`,
          bindings: { processTypeIds: [c.incomingTypeId], projectTypeIds: [], nodeKindIds: [] },
        },
        key: `it-cf-letter-${c.fx.runId}`,
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const field = customFieldDefinitionSchema.parse(await created.json());

      const live = await newLetter();
      const spam = await newLetter();
      for (const id of [live, spam]) {
        await c.fx.prisma.letter.update({
          where: { id },
          data: { customFields: { [field.id]: 'значение' } },
        });
      }

      const usage = async () =>
        customFieldUsageSchema.parse(
          await (await c.api(admin, 'GET', `/custom-fields/definitions/${field.id}/usage`)).json(),
        );
      expect((await usage()).values.letter).toBe(2);

      // Надгробие остаётся носителем: уборка определения стирает и его
      // значение, окно обязано показать реальный объём потерь (#646).
      await c.fx.prisma.letter.update({ where: { id: spam }, data: { deletedAt: new Date() } });
      expect((await usage()).values.letter).toBe(2);

      await c.fx.prisma.letter.update({ where: { id: live }, data: { customFields: {} } });
      expect((await usage()).values.letter).toBe(1);

      const removed = await c.api(admin, 'DELETE', `/custom-fields/definitions/${field.id}`, {
        key: `it-cf-letter-del-${c.fx.runId}`,
      });
      expect(removed.status, await removed.clone().text()).toBe(204);
    });

    it('удаление определения чистит ключ из letters.custom_fields (#582)', async () => {
      const admin = await adminActor();
      const created = await c.api(admin, 'POST', '/custom-fields/definitions', {
        body: {
          type: 'text',
          name: `Проба ${c.fx.runId} очистка`,
          bindings: { processTypeIds: [c.incomingTypeId], projectTypeIds: [], nodeKindIds: [] },
        },
        key: `it-cf-letter-clean-${c.fx.runId}`,
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const field = customFieldDefinitionSchema.parse(await created.json());

      const letterId = await newLetter();
      await c.fx.prisma.letter.update({
        where: { id: letterId },
        data: { customFields: { [field.id]: 'значение', keep: 'да' } },
      });

      const removed = await c.api(admin, 'DELETE', `/custom-fields/definitions/${field.id}`, {
        key: `it-cf-letter-clean-del-${c.fx.runId}`,
      });
      expect(removed.status, await removed.clone().text()).toBe(204);
      await c.fx.app.get(EventDispatcher).dispatchPending();

      const row = await c.fx.prisma.letter.findUnique({
        where: { id: letterId },
        select: { customFields: true, deletedAt: true },
      });
      expect(row?.deletedAt).toBeNull();
      expect(row?.customFields).toEqual({ keep: 'да' });
    });
  },
);
