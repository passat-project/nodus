// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';

import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';
import { demoTasks } from '../../../../shared/mocks/data/task-items.js';
import { fieldIds } from '../../../../shared/mocks/data/field-ids.js';
import { taskRowValue } from '../../../../shared/views/list-ext/list-field-values.js';
import { tasksListHandlers } from './tasks-list-handlers.js';

/**
 * Мок журнала задач с расширением (#435): предикаты атрибутов, серверная
 * сортировка (NULLS LAST + id), группы и итоги — движок-зеркало серверного
 * конвейера на демо-данных. Ожидания считаются из тех же демо-данных, без
 * дублирования чисел руками.
 */

const server = setupServer(...tasksListHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

interface PageDto {
  items: { id: string; deadline: string | null; number: number }[];
  nextCursor: string | null;
  groups?: {
    key: string | number | null;
    count: number;
    totals: { fn: string; value: number | string | null }[];
  }[];
  totals?: { fn: string; value: number | string | null }[];
}

async function list(query: string): Promise<PageDto> {
  const response = await fetch(`/api/v1/tasks?view=list&limit=100${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as PageDto;
}

const overtime = `cf.${fieldIds.overtime}`;

describe('мок /tasks: ext-конвейер (#435)', () => {
  it('фильтр по атрибуту-длительности gte отсекает невыполнившие', async () => {
    const filter = encodeURIComponent(
      JSON.stringify([{ kind: 'field', field: overtime, op: 'gte', value: 120 }]),
    );
    const page = await list(`&filter=${filter}`);
    const overtimeOf = (task: (typeof demoTasks)[number]): number | undefined =>
      task.customFields?.[fieldIds.overtime] as number | undefined;
    const expected = demoTasks
      .filter((task) => {
        const value = overtimeOf(task);
        return value !== undefined && value >= 120;
      })
      .map((task) => task.id);
    expect(page.items.map((item) => item.id).sort()).toEqual([...expected].sort());
  });

  it('сортировка по колонке-атрибуту: числа по возрастанию, пустые — в конец', async () => {
    const sort = encodeURIComponent(JSON.stringify([{ field: overtime, dir: 'asc' }]));
    const page = await list(`&sort=${sort}`);
    const byId = new Map(demoTasks.map((task) => [task.id, task]));
    const values = page.items.map((item) => taskRowValue(byId.get(item.id)!, overtime));
    const nonNull = values.filter((value): value is number => value !== null);
    expect([...nonNull].sort((a, b) => a - b)).toEqual(nonNull);
    // NULLS LAST: все заполненные раньше пустых.
    if (values.includes(null)) {
      expect(values[values.indexOf(null) - 1]).toBeDefined();
      expect(values.lastIndexOf(nonNull.at(-1)!)).toBeLessThan(values.indexOf(null));
    }
  });

  it('группировка по атрибуту с итогами: группы как в данных, сумма по группам', async () => {
    const group = encodeURIComponent(JSON.stringify({ field: overtime }));
    const totals = encodeURIComponent(
      JSON.stringify([{ fn: 'count' }, { fn: 'sum', field: overtime }]),
    );
    const page = await list(`&group=${group}&totals=${totals}`);
    expect(page.groups).toBeDefined();
    const withValue = demoTasks.filter(
      (task) => typeof task.customFields[fieldIds.overtime] === 'number',
    );
    const byValue = new Map<number, number>();
    for (const task of withValue) {
      const value = task.customFields[fieldIds.overtime] as number;
      byValue.set(value, (byValue.get(value) ?? 0) + 1);
    }
    const groupOf = (value: number) => page.groups!.find((bucket) => bucket.key === value);
    for (const [value, count] of byValue) {
      expect(groupOf(value)?.count).toBe(count);
      expect(groupOf(value)?.totals[1]?.value).toBe(value * count);
    }
    // Общие итоги — по всей выборке.
    const totalSum = [...byValue.entries()].reduce((sum, [value, count]) => sum + value * count, 0);
    expect(page.totals![0]).toEqual({ fn: 'count', value: demoTasks.length });
    expect(page.totals![1]).toEqual({ fn: 'sum', value: totalSum });
  });

  it('фильтр system_state работает системным полем', async () => {
    const filter = encodeURIComponent(JSON.stringify([{ kind: 'system_state', state: 'active' }]));
    const page = await list(`&filter=${filter}`);
    const expected = demoTasks.filter((task) => task.stage.systemState === 'active');
    expect(page.items).toHaveLength(expected.length);
  });

  it('без ext-параметров ответ прежний (без групп/итогов)', async () => {
    const page = await list('');
    expect(page.groups).toBeUndefined();
    expect(page.totals).toBeUndefined();
    // Курсорная страница: демо-мир больше лимита — есть следующая.
    expect(page.items).toHaveLength(Math.min(100, demoTasks.length));
    expect(typeof page.nextCursor).toBe(demoTasks.length > 100 ? 'string' : 'object');
  });
});

void demoCustomFieldDefinitions;
