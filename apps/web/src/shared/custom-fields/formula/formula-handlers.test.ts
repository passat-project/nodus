// @vitest-environment jsdom
import type { CustomFieldValues, FormulaNode } from '@nodus/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';

import { demoTaskCustomFields } from '../../mocks/data/custom-fields.js';
import { FORMULA_DEMO_NUMBERS, fieldIds } from '../../mocks/data/field-ids.js';
import { nodeKindSeedIds } from '../../mocks/data/node-kind-ids.js';
import { nodeIds } from '../../mocks/data/project-node-ids.js';
import { processTypeIds } from '../../mocks/data/process-type-ids.js';
import { demoTasks } from '../../mocks/data/tasks.js';

import { formulaHandlers } from './formula-handlers.js';
import { resetFormulaCells } from './formula-state.js';

/** Маршруты формул (#632) на мок-сервере: CRUD у владельца хоста, проверка
 *  и превью без записи. Коды отказа те же, что у сервера (404/400/422). */
const server = setupServer(...formulaHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const komplektTask = demoTasks.find((task) => task.type.id === processTypeIds.komplekt)!;
const cipherUrl = `/api/v1/tasks/${komplektTask.id}/custom-fields/${fieldIds.komplektCipher}/formula`;
const originals = new Map<string, CustomFieldValues>();

beforeEach(() => {
  resetFormulaCells();
  originals.set(komplektTask.id, komplektTask.customFields);
});

afterEach(() => {
  resetFormulaCells();
  const original = originals.get(komplektTask.id);
  if (original) komplektTask.customFields = original;
});

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const literal: FormulaNode = { kind: 'literal', value: 'КЖ-1' };

describe('мок формул ячейки (#632)', () => {
  it('GET без формулы — null, PUT сохраняет и материализует значение', async () => {
    const empty = await fetch(cipherUrl);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ ast: null });

    const put = await fetch(cipherUrl, json('PUT', { ast: literal }));
    expect(put.status, await put.clone().text()).toBe(200);
    expect(await put.json()).toEqual({ ast: literal });
    expect(komplektTask.customFields[fieldIds.komplektCipher]).toBe('КЖ-1');

    const read = await fetch(cipherUrl);
    expect(await read.json()).toEqual({ ast: literal });
  });

  it('DELETE снимает формулу, значение-снимок остаётся (Р5)', async () => {
    await fetch(cipherUrl, json('PUT', { ast: literal }));
    const remove = await fetch(cipherUrl, { method: 'DELETE' });
    expect(remove.status).toBe(204);
    expect(await (await fetch(cipherUrl)).json()).toEqual({ ast: null });
    expect(komplektTask.customFields[fieldIds.komplektCipher]).toBe('КЖ-1');
  });

  it('422 с кодом каталога на блокирующую формулу, 400 на битое тело', async () => {
    const mismatch = await fetch(
      `/api/v1/tasks/${komplektTask.id}/custom-fields/${fieldIds.komplektNumber}/formula`,
      json('PUT', { ast: { kind: 'literal', value: 'не число' } }),
    );
    expect(mismatch.status).toBe(422);
    expect(((await mismatch.json()) as { code: string }).code).toBe('FORMULA_TYPE_MISMATCH');

    const broken = await fetch(cipherUrl, json('PUT', { ast: { kind: 'bogus' } }));
    expect(broken.status).toBe(400);

    const unknownField = await fetch(
      `/api/v1/tasks/${komplektTask.id}/custom-fields/c0000000-0000-4000-8000-0000000000ff/formula`,
      json('PUT', { ast: literal }),
    );
    expect(unknownField.status).toBe(404);
    expect(komplektTask.customFields[fieldIds.komplektCipher]).toBeUndefined();
  });

  it('неизвестный хост и чужая папка — 404', async () => {
    const missing = await fetch(
      `/api/v1/tasks/00000000-0000-4000-8000-000000000000/custom-fields/${fieldIds.komplektCipher}/formula`,
    );
    expect(missing.status).toBe(404);

    // Папка живёт под проектом: чужой projectId в пути — 404.
    const foreignProject = await fetch(
      `/api/v1/projects/40000000-0000-4000-8000-000000000001/nodes/${nodeIds.b1}/custom-fields/${fieldIds.buildingGp}/formula`,
      json('PUT', { ast: { kind: 'literal', value: '7' } }),
    );
    expect(foreignProject.status).toBe(404);
  });
});

describe('мок проверки и превью формулы (#632)', () => {
  const cipherFormula: FormulaNode = {
    kind: 'op',
    op: 'concat',
    args: [
      { kind: 'field', source: { kind: 'project' }, number: FORMULA_DEMO_NUMBERS.projectCode },
      { kind: 'literal', value: '-' },
      {
        kind: 'field',
        source: { kind: 'folder_nearest', kindId: nodeKindSeedIds.building },
        number: FORMULA_DEMO_NUMBERS.buildingGp,
      },
    ],
  };

  it('validate: годная формула — ok и тип, запрещённый источник — issue', async () => {
    const ok = await fetch(
      '/api/v1/custom-fields/formulas/validate',
      json('POST', {
        ast: cipherFormula,
        hostKind: 'task',
        targetFieldId: fieldIds.komplektCipher,
      }),
    );
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { ok: boolean; type: string; issues: unknown[] };
    expect(okBody.ok).toBe(true);
    expect(okBody.type).toBe('string');
    expect(okBody.issues).toEqual([]);

    const forbidden = await fetch(
      '/api/v1/custom-fields/formulas/validate',
      json('POST', {
        ast: {
          kind: 'field',
          source: { kind: 'folder_chain', kindId: nodeKindSeedIds.building },
          number: FORMULA_DEMO_NUMBERS.buildingGp,
        },
        hostKind: 'task',
        targetFieldId: fieldIds.komplektCipher,
      }),
    );
    const forbiddenBody = (await forbidden.json()) as {
      ok: boolean;
      issues: Array<{ code: string; blocking: boolean }>;
    };
    expect(forbiddenBody.ok).toBe(false);
    expect(forbiddenBody.issues.some((issue) => issue.code === 'source_forbidden')).toBe(true);
  });

  it('evaluate: считает по мок-миру и отдаёт ошибку ячейки, не 500', async () => {
    const evaluated = await fetch(
      '/api/v1/custom-fields/formulas/evaluate',
      json('POST', {
        ast: cipherFormula,
        context: { hostKind: 'task', hostId: komplektTask.id },
      }),
    );
    expect(evaluated.status).toBe(200);
    expect(await evaluated.json()).toEqual({ value: '0359-1', error: null });

    const failed = await fetch(
      '/api/v1/custom-fields/formulas/evaluate',
      json('POST', {
        ast: {
          kind: 'op',
          op: 'div',
          args: [
            {
              kind: 'field',
              source: { kind: 'self' },
              number: FORMULA_DEMO_NUMBERS.komplektNumber,
            },
            { kind: 'literal', value: 0 },
          ],
        },
        context: { hostKind: 'task', hostId: komplektTask.id },
      }),
    );
    expect(failed.status).toBe(200);
    const failedBody = (await failed.json()) as { value: unknown; error: { code: string } | null };
    expect(failedBody.value).toBeNull();
    expect(failedBody.error?.code).toBe('division_by_zero');

    const noHost = await fetch(
      '/api/v1/custom-fields/formulas/evaluate',
      json('POST', {
        ast: cipherFormula,
        context: {
          hostKind: 'task',
          hostId: '00000000-0000-4000-8000-000000000000',
        },
      }),
    );
    expect(noHost.status).toBe(404);
  });
});

// Демо-значения комплекта не должны зависеть от порядка тестов файла.
it('демо-значения комплекта на месте', () => {
  expect(demoTaskCustomFields[komplektTask.id]?.[fieldIds.komplektNumber]).toBe(1);
});
