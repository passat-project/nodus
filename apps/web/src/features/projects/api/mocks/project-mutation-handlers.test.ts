// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Permission, SYSTEM_FIELD_IDS } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import { useAuthStore } from '../../../../shared/auth-store.js';
// Порядок как в app/mocks-handlers: реестр атрибутов инициализируется
// раньше данных проектов — иначе циклический граф мок-данных падает.
import '../../../../shared/custom-fields/mocks/custom-fields-handlers.js';
import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';
import { projectMutationHandlers } from './project-mutation-handlers.js';

/** Демо-типы «Договор» (required «Шифр») и «Тема» (без шифра), посев #631:
 *  литералы вместо импорта данных — не тянем цикл мок-модулей в тест. */
const CONTRACT_TYPE = '41000000-0000-4000-8000-000000000001';
const TOPIC_TYPE = '41000000-0000-4000-8000-000000000002';
const CLIENT = '90000000-0000-4000-8000-000000000001';

/** Мок создания проекта (#631, #646): значения атрибутов сохраняются, а
 *  обязательные слоты формы типа дают тот же 422, что сервер. */
const server = setupServer(...projectMutationHandlers);

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
      displayName: 'Администратор Системный',
      permissions: [Permission.PROJECT_CREATE, Permission.PROJECT_MANAGE],
    },
  });
});

const post = (body: unknown) =>
  fetch('/api/v1/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('мок POST /projects (#631)', () => {
  it('customFields создания сохраняются в проекте', async () => {
    const res = await post({
      name: `Проект мока ${crypto.randomUUID()}`,
      typeId: TOPIC_TYPE,
      customFields: { [SYSTEM_FIELD_IDS.projectClient]: CLIENT },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const detail = (await res.json()) as { customFields: Record<string, unknown> };
    expect(detail.customFields[SYSTEM_FIELD_IDS.projectClient]).toBe(CLIENT);
  });

  it('required-слот без значения — 422 PROJECT_FIELDS_REQUIRED, как сервер', async () => {
    const res = await post({
      name: `Проект мока ${crypto.randomUUID()}`,
      typeId: CONTRACT_TYPE,
      customFields: {},
    });
    expect(res.status).toBe(422);
    const error = (await res.json()) as { code: string; details: { fields: string[] } };
    expect(error.code).toBe(ErrorCode.PROJECT_FIELDS_REQUIRED);
    expect(error.details.fields).toContain(`cf.${SYSTEM_FIELD_IDS.projectCode}`);
  });

  it('неизвестный ключ — unknown, известный непривязанный — not_in_type (#655)', async () => {
    const unknown = await post({
      name: `Проект мока ${crypto.randomUUID()}`,
      typeId: TOPIC_TYPE,
      customFields: { '00000000-0000-4000-8000-00000000dead': 'x' },
    });
    expect(unknown.status).toBe(422);
    const unknownError = (await unknown.json()) as {
      details: { issues: { fieldId: string; reason: string }[] };
    };
    expect(unknownError.details.issues[0]).toMatchObject({
      fieldId: '00000000-0000-4000-8000-00000000dead',
      reason: 'unknown',
    });

    // Существующий атрибут без привязки к типу проекта — отдельная причина.
    const unbound = demoCustomFieldDefinitions.find(
      (entry) => entry.type === 'text' && entry.bindings.projectTypeIds.length === 0,
    )!;
    const foreign = await post({
      name: `Проект мока ${crypto.randomUUID()}`,
      typeId: TOPIC_TYPE,
      customFields: { [unbound.id]: 'значение' },
    });
    expect(foreign.status).toBe(422);
    const foreignError = (await foreign.json()) as {
      details: { issues: { fieldId: string; reason: string }[] };
    };
    expect(foreignError.details.issues[0]).toMatchObject({
      fieldId: unbound.id,
      reason: 'not_in_type',
    });
  });

  it('zod-провал тела — 400 VALIDATION_FAILED, не 422 (#655)', async () => {
    const res = await post({ name: 42, typeId: 'не-uuid' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
