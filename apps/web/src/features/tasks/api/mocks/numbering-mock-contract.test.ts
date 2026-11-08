// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { customFieldDefinitionSchema, ErrorCode } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import {
  counterRuleOf,
  mockCounts,
  mockHostAssignments,
  mockIssuedCount,
} from '../../../../shared/mocks/data/numbering-store.js';
import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';
import { fieldIds } from '../../../../shared/mocks/data/field-ids.js';
import { nodeIds } from '../../../../shared/mocks/data/project-node-ids.js';
import { demoTasks } from '../../../../shared/mocks/data/task-items.js';
import {
  CHANGE_WORKFLOW_ID,
  demoWorkflowDetails,
} from '../../../../shared/mocks/data/workflows.js';
import { numberingHandlers } from '../../../../shared/custom-fields/mocks/numbering-handlers.js';
import { tasksTransitionsHandlers } from './tasks-transitions-handlers.js';
import {
  placeOfNewNode,
  placeOfNewProject,
  placeOfNewTask,
  planOnCreate,
  stripCounterValues,
} from '../../../../shared/mocks/data/numbering-create.js';
import { nodeKindSeedIds } from '../../../../shared/mocks/data/node-kind-ids.js';
import { demoProjectGroups, demoProjectTypeIds } from '../../../../shared/mocks/data/projects.js';
import { projectRefs } from '../../../../shared/mocks/data/task-item-factory.js';
import { processTypeIds } from '../../../../shared/mocks/data/process-type-ids.js';

const KZH_PROJECT = projectRefs.p4.id;

/**
 * Паритет мок-мира счётчиков с сервером (#630, модель v3 — вердикты 08.11):
 * «Изменение» получает Изм. и № разрешения ПРИ СОЗДАНИИ (их пишут в штамп),
 * накладную — кнопкой «Выдать в печать». Вне комплекта — 409 без траты
 * номеров; пустое поле в номере — 409 NUMBER_SEGMENT_EMPTY до подтверждения;
 * повторное нажатие номер не меняет; ручная запись номера — 422.
 */
const server = setupServer(...tasksTransitionsHandlers, ...numberingHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

const issue = () =>
  demoWorkflowDetails[CHANGE_WORKFLOW_ID]!.document.transitions.find(
    (t) => t.code === 'issue_print',
  )!;

const taskIn = (title: string) => demoTasks.find((task) => task.title === title)!;

async function press(taskId: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`/api/v1/tasks/${taskId}/transitions/${issue().id}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('мок счётчиков: паритет с сервером (#630, модель v3)', () => {
  it('counter-определения — по контракту, «при создании» у типов', () => {
    const counters = demoCustomFieldDefinitions.filter((entry) => entry.type === 'counter');
    expect(counters.length).toBe(5);
    for (const definition of counters) {
      expect(customFieldDefinitionSchema.safeParse(definition).success).toBe(true);
    }
    expect(counterRuleOf(fieldIds.changeNumber)!.containers[0]?.kind).toBe('folder');
    expect(counterRuleOf(fieldIds.permitNumber)!.containers).toEqual([]);
    expect(counterRuleOf(fieldIds.permitNumber)!.period).toBe('year');
    const change = counters.find((entry) => entry.id === fieldIds.changeNumber)!;
    expect(change.numbering!.onCreate).toEqual([processTypeIds.change]);
  });

  it('новое «Изменение» в КЖ-01 сразу получает Изм. 3 и следующий № книги', () => {
    const values = stripCounterValues({ [fieldIds.changeNumber]: 'Изм. 99' });
    const plan = planOnCreate(
      placeOfNewTask({
        nodeId: nodeIds.kzh01,
        projectId: KZH_PROJECT,
        parentId: null,
        typeId: processTypeIds.change,
        values,
      }),
      values,
      { source: 'create' },
    );
    expect(plan.ok).toBe(true);
    const numbers = plan.ok ? plan.issue('00000000-0000-4000-8000-00000000c630') : {};
    expect(numbers[fieldIds.changeNumber]).toBe('Изм. 3');
    expect(numbers[fieldIds.permitNumber]).toMatch(/^18-\d{2}$/);
    expect(mockHostAssignments('task', '00000000-0000-4000-8000-00000000c630')).toHaveLength(2);
  });

  it('«Изменение» вне комплекта не создаётся, номера не тратятся', () => {
    const before = mockIssuedCount(fieldIds.permitNumber);
    const plan = planOnCreate(
      placeOfNewTask({
        nodeId: null,
        projectId: KZH_PROJECT,
        parentId: null,
        typeId: processTypeIds.change,
        values: {},
      }),
      {},
      { source: 'create' },
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.failure).toMatchObject({ kind: 'missing', reason: 'no_folder' });
    expect(mockIssuedCount(fieldIds.permitNumber)).toBe(before);
  });

  it('«Выдать в печать» → накладная «0412-1»; повторное нажатие номер не меняет', async () => {
    const task = taskIn('Изменение КЖ-01: отверстия в плите');
    const first = await press(task.id);
    expect(first.status).toBe(200);
    expect(task.customFields[fieldIds.waybillNumber]).toBe('0412-1');
    expect(task.customFields[fieldIds.changeNumber]).toBe('Изм. 1');
    const again = await press(task.id);
    expect(again.status).toBe(200);
    expect(task.customFields[fieldIds.waybillNumber]).toBe('0412-1');
    const journal = mockHostAssignments('task', task.id).find(
      (entry) => entry.fieldId === fieldIds.waybillNumber,
    );
    expect(journal).toMatchObject({ source: 'transition', sourceLabel: 'Выдать в печать' });
  });

  it('пустой «Инв. №» — 409 до подтверждения, с подтверждением — номер без него', async () => {
    const task = taskIn('Изменение ОВ: трассы вентиляции');
    const blocked = await press(task.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe(ErrorCode.NUMBER_SEGMENT_EMPTY);
    expect(task.customFields[fieldIds.waybillNumber]).toBeUndefined();
    const confirmed = await press(task.id, { confirmEmptyNumberParts: true });
    expect(confirmed.status).toBe(200);
    expect(task.customFields[fieldIds.waybillNumber]).toBe('-1');
  });

  it('«Текущие счета»: КЖ-01 последний Изм. 3, следующий только вперёд', async () => {
    const rule = counterRuleOf(fieldIds.changeNumber)!;
    const kzh01 = mockCounts(fieldIds.changeNumber, rule, '').find(
      (count) => count.containers[0]?.id === nodeIds.kzh01,
    );
    expect(kzh01).toBeDefined();
    const backwards = await fetch(
      `/api/v1/custom-fields/definitions/${fieldIds.changeNumber}/numbering/next`,
      {
        method: 'PUT',
        body: JSON.stringify({ containerIds: [nodeIds.kzh01], nextValue: 1 }),
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(backwards.status).toBe(409);
  });

  it('выдача существующим: предпросмотр и одобрение, устаревший — 409', async () => {
    const url = `/api/v1/custom-fields/definitions/${fieldIds.permitNumber}/numbering/backfill`;
    const preview = (await (await fetch(`${url}/preview`, { method: 'POST' })).json()) as {
      total: number;
    };
    expect(preview.total).toBeGreaterThan(0);
    const stale = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ expectedTotal: preview.total + 5 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(stale.status).toBe(409);
    const run = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ expectedTotal: preview.total }),
      headers: { 'content-type': 'application/json' },
    });
    expect(((await run.json()) as { issued: number }).issued).toBe(preview.total);
  });

  it('папке и проекту номер при создании: место есть — выдан, нет портфеля — отказ', () => {
    const inKr = planOnCreate(
      placeOfNewNode(KZH_PROJECT, nodeIds.b1kr, nodeKindSeedIds.komplekt, {}),
      {},
      { source: 'create' },
    );
    expect(inKr.ok && inKr.issue('00000000-0000-4000-8000-00000000d001')).toEqual({
      [fieldIds.komplektSeq]: 'К-03',
    });
    const noPortfolio = planOnCreate(
      placeOfNewProject(demoProjectTypeIds.contract, null, {}),
      {},
      { source: 'create' },
    );
    expect(noPortfolio.ok).toBe(false);
    const inPortfolio = planOnCreate(
      placeOfNewProject(demoProjectTypeIds.contract, demoProjectGroups[0]!.id, {}),
      {},
      { source: 'create' },
    );
    expect(
      inPortfolio.ok &&
        inPortfolio.issue('00000000-0000-4000-8000-00000000d002')[fieldIds.projectSeq],
    ).toMatch(/^\d{3}\/\d{2}$/);
  });
});
