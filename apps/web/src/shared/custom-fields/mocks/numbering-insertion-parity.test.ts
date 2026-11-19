// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import { useAuthStore } from '../../auth-store.js';
import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { fieldIds } from '../../mocks/data/field-ids.js';
import { customFieldsHandlers } from './custom-fields-handlers.js';

/**
 * Паритет мок-реестра с сервером по вставкам номера (#877, AUD-010): правило
 * с вставкой неподдержанного типа не сохраняется — 422
 * `NUMBER_SEGMENT_UNSUPPORTED`, как `CounterRuleService.assertInsertions`.
 * Мок не «добрее» сервера: демо-контур — то, на чём владелец принимает экраны
 * (ADR-0001).
 */
const server = setupServer(...customFieldsHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function signIn(): void {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: null,
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'admin@nodus.by',
      displayName: 'Администратор',
      permissions: [Permission.CUSTOM_FIELD_MANAGE],
    },
  });
}

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** Правило-заготовка с одной вставкой поля по его номеру. */
const ruleWith = (fieldNumber: number) => ({
  containers: [],
  period: 'none' as const,
  template: [
    { kind: 'counter' as const, minLength: 3 },
    { kind: 'field' as const, fieldNumber, source: 'self' as const },
  ],
  startValue: 1,
  step: 1,
});

function counterBody(name: string, bindings: string[], fieldNumber: number) {
  return {
    type: 'counter',
    name,
    bindings: { processTypeIds: bindings, projectTypeIds: [], nodeKindIds: [] },
    numbering: ruleWith(fieldNumber),
  };
}

describe('мок custom-fields: вставка номера без печатного значения — 422 (#877)', () => {
  beforeEach(() => signIn());

  it('создание: вставка денег отвергается, текст проходит', async () => {
    const money = demoCustomFieldDefinitions.find(
      (entry) => entry.type === 'money' && entry.bindings.processTypeIds.length > 0,
    );
    expect(money, 'в демо-мире есть поле-деньги у типа процесса').toBeDefined();
    const processTypes = money!.bindings.processTypeIds;

    const rejected = await fetch(
      '/api/v1/custom-fields/definitions',
      json('POST', counterBody('Проба вставки денег', processTypes, money!.number)),
    );
    expect(rejected.status).toBe(422);
    expect(((await rejected.json()) as { code: string }).code).toBe(
      ErrorCode.NUMBER_SEGMENT_UNSUPPORTED,
    );

    const text = demoCustomFieldDefinitions.find(
      (entry) =>
        (entry.type === 'text' || entry.type === 'number') &&
        entry.bindings.processTypeIds.length > 0,
    );
    expect(text, 'в демо-мире есть печатное поле у типа процесса').toBeDefined();

    const created = await fetch(
      '/api/v1/custom-fields/definitions',
      json(
        'POST',
        counterBody('Проба вставки текста', text!.bindings.processTypeIds, text!.number),
      ),
    );
    expect(created.status).toBe(201);

    // Мок-реестр — общий модуль состояния: убираем созданное, чтобы не течь в другие тесты.
    const index = demoCustomFieldDefinitions.findIndex(
      (entry) => entry.name === 'Проба вставки текста',
    );
    if (index >= 0) demoCustomFieldDefinitions.splice(index, 1);
  });

  it('правка правила: деньги в номере не сохраняются, правило не меняется', async () => {
    const counter = demoCustomFieldDefinitions.find(
      (entry) =>
        entry.id === fieldIds.changeNumber &&
        entry.type === 'counter' &&
        entry.bindings.processTypeIds.length > 0,
    );
    expect(counter, 'демо-счётчик «Изм.» на месте').toBeDefined();
    const before = JSON.stringify(counter!.numbering?.rule);

    const money = demoCustomFieldDefinitions.find(
      (entry) => entry.type === 'money' && entry.bindings.processTypeIds.length > 0,
    );
    const rejected = await fetch(
      `/api/v1/custom-fields/definitions/${fieldIds.changeNumber}`,
      json('PATCH', { numbering: ruleWith(money!.number) }),
    );
    expect(rejected.status).toBe(422);
    expect(((await rejected.json()) as { code: string }).code).toBe(
      ErrorCode.NUMBER_SEGMENT_UNSUPPORTED,
    );
    expect(JSON.stringify(counter!.numbering?.rule)).toBe(before);
  });
});
