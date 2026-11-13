// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Permission, creationSlots } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import { useAuthStore } from '../../auth-store.js';
import { demoFieldById, demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { fieldIds } from '../../mocks/data/field-ids.js';
import { creationFormOf, mockTypes } from '../../mocks/data/process-types-store.js';
import { customFieldsHandlers } from './custom-fields-handlers.js';

/**
 * Паритет мок-реестра с сервером (#655, бэклог #631): глобальная переменная
 * не принимает привязок, PATCH проверяет справочник/валюту настроек,
 * умолчание и глобальное значение проходят ссылочную проверку, а zod-провал
 * тела — 400, не 422.
 */
const server = setupServer(...customFieldsHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: null,
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'admin@nodus.by',
      displayName: 'Администратор',
      permissions: [Permission.CUSTOM_FIELD_MANAGE, Permission.DICTIONARY_MANAGE],
    },
  });
});

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const definitionUrl = (id: string) => `/api/v1/custom-fields/definitions/${id}`;

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code;
}

describe('паритет мока реестра с сервером (#655)', () => {
  it('глобальная переменная с привязками при создании — 422, как сервер', async () => {
    const res = await fetch(
      '/api/v1/custom-fields/definitions',
      json('POST', {
        type: 'text',
        name: `Переменная ${crypto.randomUUID()}`,
        isCompany: true,
        bindings: {
          processTypeIds: ['40000000-0000-4000-8000-000000000001'],
          projectTypeIds: [],
          nodeKindIds: [],
        },
      }),
    );
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe(ErrorCode.CUSTOM_FIELD_BINDING_INVALID);
  });

  it('PATCH проверяет settings.dictionaryId — 400 VALIDATION_FAILED', async () => {
    const field = demoCustomFieldDefinitions.find((entry) => entry.type === 'enum')!;
    const res = await fetch(
      definitionUrl(field.id),
      json('PATCH', {
        settings: { dictionaryId: '00000000-0000-4000-8000-00000000dead' },
      }),
    );
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe(ErrorCode.VALIDATION_FAILED);
    // Отказ не оставил частичной правки.
    expect(demoFieldById(field.id)?.settings.dictionaryId).toBe(field.settings.dictionaryId);
  });

  it('статическое умолчание с несуществующим вариантом — 422 (ссылочная проверка)', async () => {
    const field = demoCustomFieldDefinitions.find(
      (entry) => entry.type === 'enum' || entry.type === 'multienum',
    )!;
    const value =
      field.type === 'multienum'
        ? ['00000000-0000-4000-8000-00000000dead']
        : '00000000-0000-4000-8000-00000000dead';
    const res = await fetch(
      definitionUrl(field.id),
      json('PATCH', { defaultValue: { kind: 'static', value } }),
    );
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe(ErrorCode.CUSTOM_FIELD_VALUE_INVALID);
  });

  it('глобальное значение-ссылка на запись — 422 not_found (без актёра)', async () => {
    const created = await fetch(
      '/api/v1/custom-fields/definitions',
      json('POST', {
        type: 'task',
        name: `Задача компании ${crypto.randomUUID()}`,
        isCompany: true,
      }),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(
      `${definitionUrl(id)}/company-value`,
      json('PUT', { value: '00000000-0000-4000-8000-00000000beef' }),
    );
    expect(res.status).toBe(422);
    const error = (await res.json()) as { details: { issues: { reason: string }[] } };
    expect(error.details.issues[0]?.reason).toBe('not_found');
  });

  it('zod-провал PATCH — 400, не 422', async () => {
    const field = demoCustomFieldDefinitions[0]!;
    const res = await fetch(definitionUrl(field.id), json('PATCH', { type: 'нет-такого' }));
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('удаление атрибута чистит слот cf.<id> из формы создания маршрута', async () => {
    // «Дата переработки» стоит required-слотом в форме создания «Переработки».
    const id = fieldIds.overtimeDate;
    expect(demoFieldById(id)).toBeTruthy();
    const res = await fetch(definitionUrl(id), { method: 'DELETE' });
    expect(res.status).toBe(204);
    const keys = mockTypes.flatMap((type) =>
      creationSlots(creationFormOf(type)).map((slot) => slot.key),
    );
    expect(keys).not.toContain(`cf.${id}`);
  });
});
