import type { ConversationListItem, TaskListItem } from '@nodus/contracts';
import { describe, expect, it } from 'vitest';

import { buildReply, type AssistantContext } from './mock-engine.js';

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

function task(p: Partial<TaskListItem>): TaskListItem {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    number: 101,
    title: 'Согласовать структуру CDE',
    stage: { name: 'В работе', systemState: 'in_progress', outcome: null },
    priority: 'normal',
    deadline: iso(NOW - 86_400_000),
    assignee: { id: 'u1', displayName: 'Александр Климович', avatarUrl: null },
    project: null,
    spentMinutes: 0,
    plannedMinutes: null,
    ...p,
  } as TaskListItem;
}

function ctx(p: Partial<AssistantContext> = {}): AssistantContext {
  return {
    moduleId: 'tasks',
    moduleLabel: 'Задачи',
    cardKind: null,
    cardTask: null,
    tasks: [],
    conversations: [],
    meId: 'u1',
    ...p,
  };
}

describe('buildReply: ветки контекстного ответа', () => {
  it('просрочка: перечисляет активные просроченные задачи', () => {
    const overdue = task({ number: 101 });
    const closed = task({
      id: '30000000-0000-4000-8000-000000000002',
      number: 102,
      stage: {
        name: 'Завершена',
        systemState: 'done',
        outcome: 'done',
      } as unknown as TaskListItem['stage'],
    });
    const reply = buildReply('что у меня просрочено?', ctx({ tasks: [overdue, closed] }));
    expect(reply).toContain('просрочено 1');
    expect(reply).toContain('№101');
    expect(reply).not.toContain('№102');
  });

  it('просрочки нет: ближайший срок вместо списка', () => {
    const future = task({ deadline: iso(NOW + 3 * 86_400_000) });
    const reply = buildReply('что просрочено?', ctx({ tasks: [future] }));
    expect(reply).toContain('Просроченных задач в вашем списке нет');
    expect(reply).toContain('№101');
  });

  it('план на день: просрочка и сроки сегодня/завтра', () => {
    const reply = buildReply(
      'спланируй мой день',
      ctx({ tasks: [task({}), task({ id: 'x2', number: 105, deadline: iso(NOW + 3_600_000) })] }),
    );
    expect(reply).toContain('План на день');
    expect(reply).toContain('№105');
  });

  it('резолюция: черновик со сроком и оговоркой концепта', () => {
    const reply = buildReply('помоги написать резолюцию', ctx());
    expect(reply).toContain('Черновик резолюции');
    expect(reply).toContain('поручением в Nodus');
  });

  it('открытая карточка задачи: паспорт карточки в ответе', () => {
    const card = task({ number: 102, title: 'Разработать модель 3D', spentMinutes: 120 });
    const reply = buildReply('расскажи о карточке', ctx({ cardKind: 'task', cardTask: card }));
    expect(reply).toContain('№102 «Разработать модель 3D»');
    expect(reply).toContain('2 ч');
  });

  it('мессенджер: сводка непрочитанных по moduleId, не по i18n-метке', () => {
    const conv = {
      type: 'group',
      title: 'Новости компании',
      unreadCount: 2,
      snoozed: false,
      membersPreview: [],
    } as unknown as ConversationListItem;
    const reply = buildReply('что нового?', ctx({ moduleId: 'chat', conversations: [conv] }));
    expect(reply).toContain('Непрочитанных бесед: 1');
    expect(reply).toContain('Новости компании');
  });

  it('фолбэк: раздел и возможности концепта', () => {
    const reply = buildReply('привет', ctx({ moduleId: 'projects', moduleLabel: 'Проекты' }));
    expect(reply).toContain('Вы в разделе «Проекты»');
    expect(reply).toContain('В концепте умею');
  });
});
