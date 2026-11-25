import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_EVENTS,
  CORRESPONDENCE_EVENTS,
  DIRECTORY_EVENTS,
  PROJECT_EVENTS,
  TASK_EVENTS,
  type DomainEvent,
} from '@nodus/contracts';

import {
  SearchIndexDirectoryHandler,
  SearchIndexLetterHandler,
  SearchIndexMessageHandler,
  SearchIndexProjectHandler,
  SearchIndexRunner,
  SearchIndexTaskHandler,
} from './search-index.handlers.js';

/**
 * Инкрементальная индексация из outbox (#952): подписки `eventTypes` на
 * группах событий и разводка runner'а по типу источника. Ошибка в ключе
 * payload здесь молча оставляла бы проекцию устаревшей — цены теста нет
 * (code-reviewer #952).
 */
const event = (type: string, payload: Record<string, unknown>) =>
  ({ type, payload }) as unknown as DomainEvent<Record<string, unknown>>;

const runnerWith = () => {
  const index = {
    indexIds: vi.fn().mockResolvedValue(undefined),
    indexByDepartment: vi.fn().mockResolvedValue(undefined),
    indexByPosition: vi.fn().mockResolvedValue(undefined),
  };
  return { index, runner: new SearchIndexRunner(index as never) };
};

describe('обработчики outbox → проекция поиска (#952)', () => {
  it('подписки групп событий: каждая группа покрывает свои типы', () => {
    expect(SearchIndexTaskHandler.eventTypes).toEqual([
      TASK_EVENTS.CREATED,
      TASK_EVENTS.UPDATED,
      TASK_EVENTS.ASSIGNED,
      TASK_EVENTS.PARTICIPANTS_CHANGED,
      TASK_EVENTS.DELETED,
    ]);
    expect(SearchIndexMessageHandler.eventTypes).toContain(CHAT_EVENTS.MESSAGE_SENT);
    expect(SearchIndexLetterHandler.eventTypes).toContain(
      CORRESPONDENCE_EVENTS.LETTER_RELATIONS_CHANGED,
    );
    expect(SearchIndexProjectHandler.eventTypes).toContain(PROJECT_EVENTS.UPDATED);
    expect(SearchIndexDirectoryHandler.eventTypes).toContain(DIRECTORY_EVENTS.USER_DEACTIVATED);
    expect(SearchIndexDirectoryHandler.eventTypes).toContain(DIRECTORY_EVENTS.DEPARTMENT_DELETED);
  });

  it('handler делегирует событие в runner', async () => {
    const { index } = runnerWith();
    const handler = new SearchIndexTaskHandler(new SearchIndexRunner(index as never));
    await handler.handle(event(TASK_EVENTS.UPDATED, { taskId: 'task-1' }));
    expect(index.indexIds).toHaveBeenCalledWith('task', ['task-1']);
  });

  it('task/message/letter/project/user — точечная индексация по id', async () => {
    const { index, runner } = runnerWith();
    await runner.run(event(TASK_EVENTS.ASSIGNED, { taskId: 't1' }));
    await runner.run(event(CHAT_EVENTS.MESSAGE_EDITED, { messageId: 'm1' }));
    await runner.run(event(CORRESPONDENCE_EVENTS.LETTER_RELATIONS_CHANGED, { letterId: 'l1' }));
    await runner.run(event(PROJECT_EVENTS.UPDATED, { projectId: 'p1' }));
    await runner.run(event(DIRECTORY_EVENTS.USER_DEACTIVATED, { userId: 'u1' }));
    expect(index.indexIds.mock.calls).toEqual([
      ['task', ['t1']],
      ['message', ['m1']],
      ['letter', ['l1']],
      ['project', ['p1']],
      ['employee', ['u1']],
    ]);
  });

  it('удаление подразделения переиндексирует прямых сотрудников по userIds', async () => {
    const { index, runner } = runnerWith();
    await runner.run(event(DIRECTORY_EVENTS.DEPARTMENT_DELETED, { userIds: ['u1', 42, 'u2'] }));
    expect(index.indexIds.mock.calls).toEqual([['employee', ['u1', 'u2']]]);
  });

  it('оргструктура: отдел/должность/держатели, пустые payload — без вызовов', async () => {
    const { index, runner } = runnerWith();
    await runner.run(event(DIRECTORY_EVENTS.DEPARTMENT_ARCHIVED, { departmentId: 'd1' }));
    await runner.run(event(DIRECTORY_EVENTS.POSITION_DELETED, { positionId: 'pos1' }));
    await runner.run(
      event(DIRECTORY_EVENTS.POSITION_UPDATED, {
        positionId: 'pos2',
        targetId: 'pos3',
        changedFields: ['holders'],
        userIds: ['u1', 42],
      }),
    );
    await runner.run(event(TASK_EVENTS.UPDATED, {}));
    await runner.run(event('unknown.event', { taskId: 't1' }));
    expect(index.indexByDepartment.mock.calls).toEqual([['d1']]);
    expect(index.indexByPosition.mock.calls).toEqual([['pos1'], ['pos3'], ['pos2']]);
    expect(index.indexIds.mock.calls).toEqual([['employee', ['u1']]]);
  });
});
