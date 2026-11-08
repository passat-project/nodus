// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { customFieldDefinitionSchema, ErrorCode } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import {
  counterRuleOf,
  mockCounts,
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
  issueOnCreate,
  placeOfNewNode,
  placeOfNewProject,
} from '../../../../shared/mocks/data/numbering-create.js';
import { nodeKindSeedIds } from '../../../../shared/mocks/data/node-kind-ids.js';
import { demoProjectGroups, demoProjectTypeIds } from '../../../../shared/mocks/data/projects.js';
import { projectRefs } from '../../../../shared/mocks/data/task-item-factory.js';

const KZH_PROJECT = projectRefs.p4.id;

/**
 * Паритет мок-мира счётчиков с сервером (#630, концепция 08.11): номера
 * работ «Изменение» внутри РЕАЛЬНЫХ папок «Комплект». Кейсы: A — КЖ-01
 * продолжает свой счёт, КЖ-02 начинает с 1; C — общий счёт с 1041; D —
 * книга года; F — три номера одним нажатием; работа вне комплекта — 409
 * NUMBER_CONTAINER_MISSING и ни один номер не тратится; повторное нажатие
 * номер не меняет.
 */
const server = setupServer(...tasksTransitionsHandlers, ...numberingHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

const issue = () =>
  demoWorkflowDetails[CHANGE_WORKFLOW_ID]!.document.transitions.find(
    (t) => t.code === 'issue_print',
  )!;

const taskIn = (title: string) => demoTasks.find((task) => task.title === title)!;

async function press(taskId: string) {
  const response = await fetch(`/api/v1/tasks/${taskId}/transitions/${issue().id}`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'content-type': 'application/json' },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('мок счётчиков: паритет с сервером (#630)', () => {
  it('магазин содержит counter-определения с правилом «внутри чего»', () => {
    const counters = demoCustomFieldDefinitions.filter((entry) => entry.type === 'counter');
    expect(counters.length).toBe(5);
    for (const definition of counters) {
      expect(customFieldDefinitionSchema.safeParse(definition).success).toBe(true);
    }
    expect(counterRuleOf(fieldIds.changeNumber)!.container.kind).toBe('folder');
    expect(counterRuleOf(fieldIds.tookChangeNumber)!.container.kind).toBe('company');
    expect(counterRuleOf(fieldIds.permitNumber)!.period).toBe('year');
  });

  it('Кейсы A/C/D/F: одно нажатие — три номера; КЖ-02 начинает с «Изм. 1»', async () => {
    const kzh01 = taskIn('Изменение КЖ-01: армирование ростверка');
    const first = await press(kzh01.id);
    expect(first.status).toBe(200);
    const numbers = first.body.assignedNumbers as { fieldId: string; display: string }[];
    expect(numbers.map((entry) => entry.display)).toEqual(
      expect.arrayContaining(['Изм. 2', '1042']),
    );
    expect(numbers.find((entry) => entry.fieldId === fieldIds.permitNumber)?.display).toMatch(
      /^16-\d{2}$/,
    );

    const kzh02 = taskIn('Изменение КЖ-02: закладные детали');
    const second = await press(kzh02.id);
    const displays = (second.body.assignedNumbers as { display: string }[]).map((e) => e.display);
    expect(displays).toContain('Изм. 1');
    expect(displays).toContain('1043');

    const counts = mockCounts(fieldIds.changeNumber, counterRuleOf(fieldIds.changeNumber)!, '');
    expect(counts.find((c) => c.container?.id === nodeIds.kzh02)?.nextDisplay).toBe('Изм. 2');
  });

  it('повторное нажатие номер не меняет и счётчик не двигает', async () => {
    const task = taskIn('Изменение КЖ-01: отверстия в плите');
    const before = mockIssuedCount(fieldIds.changeNumber);
    const again = await press(task.id);
    expect(again.status).toBe(200);
    expect(again.body.assignedNumbers).toBeUndefined();
    expect(task.customFields[fieldIds.changeNumber]).toBe('Изм. 1');
    expect(mockIssuedCount(fieldIds.changeNumber)).toBe(before);
  });

  it('работа вне комплекта — 409 NUMBER_CONTAINER_MISSING, общий счёт не тратится', async () => {
    const task = taskIn('Изменение без комплекта: план кровли');
    const before = mockIssuedCount(fieldIds.tookChangeNumber);
    const result = await press(task.id);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe(ErrorCode.NUMBER_CONTAINER_MISSING);
    expect(mockIssuedCount(fieldIds.tookChangeNumber)).toBe(before);
    expect(task.customFields[fieldIds.tookChangeNumber]).toBeUndefined();
  });

  it('проверка на записи: задача → КЖ-01 → следующий номер; чужой тип — not_participant', async () => {
    const rule = counterRuleOf(fieldIds.changeNumber)!;
    const task = taskIn('Изменение КЖ-01: отверстия в плите');
    const response = await fetch('/api/v1/custom-fields/numbering/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        definitionId: fieldIds.changeNumber,
        rule,
        participantTypeIds: [task.type.id],
        host: { kind: 'task', id: task.id },
      }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      container: { name: string; path: string[] };
      alreadyAssigned: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.container.name).toBe('КЖ-01');
    expect(body.container.path[0]).toBe('Главный корпус галургической фабрики');
    expect(body.alreadyAssigned).toBe('Изм. 1');

    const foreign = await fetch('/api/v1/custom-fields/numbering/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rule, participantTypeIds: [], host: { kind: 'task', id: task.id } }),
    });
    expect(((await foreign.json()) as { reason: string }).reason).toBe('not_participant');
  });

  it('следующий номер — только вперёд (409 NUMBER_NEXT_BACKWARDS)', async () => {
    const put = (nextValue: number) =>
      fetch(`/api/v1/custom-fields/definitions/${fieldIds.tookChangeNumber}/numbering/next`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ containerId: null, nextValue }),
      });
    expect((await put(5)).status).toBe(409);
    expect((await put(2000)).status).toBe(200);
  });
});

describe('мок счётчиков: выдача «При создании записи» (#630)', () => {
  it('папка «Комплект» получает № внутри папки, где создана; в корне — внутри проекта', () => {
    const inKr = issueOnCreate(
      placeOfNewNode(KZH_PROJECT, nodeIds.b1kr, {}),
      nodeKindSeedIds.komplekt,
      {},
    );
    expect(inKr).toEqual({ ok: true, values: { [fieldIds.komplektSeq]: 'К-03' } });
    const inRoot = issueOnCreate(
      placeOfNewNode(KZH_PROJECT, null, {}),
      nodeKindSeedIds.komplekt,
      {},
    );
    expect(inRoot).toEqual({ ok: true, values: { [fieldIds.komplektSeq]: 'К-01' } });
  });

  it('договор без портфеля — отказ с причиной, номер не тратится; с портфелем — 001/ГГ', () => {
    const before = mockIssuedCount(fieldIds.projectSeq);
    const refused = issueOnCreate(
      placeOfNewProject(demoProjectTypeIds.contract, null, {}),
      demoProjectTypeIds.contract,
      {},
    );
    expect(refused).toMatchObject({
      ok: false,
      fieldId: fieldIds.projectSeq,
      reason: 'no_portfolio',
    });
    expect(mockIssuedCount(fieldIds.projectSeq)).toBe(before);
    const portfolio = demoProjectGroups[0]!.id;
    const issued = issueOnCreate(
      placeOfNewProject(demoProjectTypeIds.contract, portfolio, {}),
      demoProjectTypeIds.contract,
      {},
    );
    expect(issued.ok && issued.values[fieldIds.projectSeq]).toMatch(/^001\/\d{2}$/);
  });
});
