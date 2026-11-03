import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Permission,
  customFieldDefinitionSchema,
  customFieldUsageSchema,
  letterDetailSchema,
} from '@nodus/contracts';

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

    it('считает живые письма, не считает спам; очистка значения обнуляет', async () => {
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
          scope: 'letter',
          type: 'text',
          name: `Проба ${c.fx.runId} письмо`,
          typeIds: [c.incomingTypeId],
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
      expect((await usage()).valueCount).toBe(2);

      await c.fx.prisma.letter.update({ where: { id: spam }, data: { deletedAt: new Date() } });
      expect((await usage()).valueCount).toBe(1);

      await c.fx.prisma.letter.update({ where: { id: live }, data: { customFields: {} } });
      expect((await usage()).valueCount).toBe(0);

      const removed = await c.api(admin, 'DELETE', `/custom-fields/definitions/${field.id}`, {
        key: `it-cf-letter-del-${c.fx.runId}`,
      });
      expect(removed.status, await removed.clone().text()).toBe(204);
    });
  },
);
