import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  customFieldDefinitionSchema,
  dictionarySchema,
  ErrorCode,
} from '@nodus/contracts';

import { setupCustomFieldsFixture, type CustomFieldsFixture } from './custom-fields-fixtures.js';

/**
 * Словарные права (#604, I8): сервер — истина, блокировка UI #491 —
 * только подсказка. `custom_field.manage` без `dictionary.manage` не создаёт
 * список на словаре (403 до проверки существования словаря), но правит имя
 * уже созданного списка (контракт #491). PATCH-схема настроек знает только
 * precision/currencyId — словарная поверхность правки закрыта контрактом.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'custom fields: словарные права (integration, #604)',
  () => {
    let cf: CustomFieldsFixture;

    beforeAll(async () => {
      cf = await setupCustomFieldsFixture();
    }, 120_000);

    afterAll(async () => {
      await cf?.cleanup();
    });

    it('создание списка на словаре без dictionary.manage — 403 (#604)', async () => {
      const { fx, admin, fieldAdmin } = cf;
      const dictRes = await fx.api(admin, 'POST', '/dictionaries', {
        body: { name: `Список ${fx.runId}`, items: ['А'] },
        key: `it-cf-dict-create-${fx.runId}`,
      });
      expect(dictRes.status, await dictRes.clone().text()).toBe(201);
      const dictionary = dictionarySchema.parse(await dictRes.json());
      cf.dictionaryIds.push(dictionary.id);

      // custom_field.manage без dictionary.manage: создать список на словаре
      // нельзя — 403, а не 404/422-оракул (I8).
      const denied = await fx.api(fieldAdmin, 'POST', '/custom-fields/definitions', {
        body: {
          type: 'enum',
          name: `Чужой список ${fx.runId}`,
          settings: { dictionaryId: dictionary.id },
        },
        key: `it-cf-dict-deny-${fx.runId}`,
      });
      expect(denied.status).toBe(403);
      expect(apiErrorResponseSchema.parse(await denied.json()).code).toBe(ErrorCode.FORBIDDEN);

      // Список создан админом с обоими правами; правка имени без
      // dictionary.manage остаётся разрешённой (контракт #491).
      const created = await fx.api(admin, 'POST', '/custom-fields/definitions', {
        body: {
          type: 'enum',
          name: `Список ${fx.runId}`,
          settings: { dictionaryId: dictionary.id },
        },
        key: `it-cf-dict-ok-${fx.runId}`,
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const field = customFieldDefinitionSchema.parse(await created.json());
      cf.definitionIds.push(field.id);

      const renamed = await fx.api(fieldAdmin, 'PATCH', `/custom-fields/definitions/${field.id}`, {
        body: { name: `Переименован ${fx.runId}` },
        key: `it-cf-dict-rename-${fx.runId}`,
      });
      expect(renamed.status, await renamed.clone().text()).toBe(200);

      const changed = await fx.api(fieldAdmin, 'PATCH', `/custom-fields/definitions/${field.id}`, {
        body: { settings: { dictionaryId: '00000000-0000-4000-8000-000000000000' } },
        key: `it-cf-dict-change-${fx.runId}`,
      });
      expect(changed.status).toBe(400);
    });
  },
);
