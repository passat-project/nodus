import { describe, expect, it } from 'vitest';
import type { FolderListItem, LetterListItem, TaskListItem } from '@nodus/contracts';

import { folderRowValue, letterRowValue, taskRowValue } from './list-field-values.js';

const task = {
  number: 7,
  title: 'КЖ 1.1',
  stage: { id: 'stage-1' },
  deadline: '2026-10-20T10:00:00.000Z',
  assignee: { id: 'user-1' },
  type: { id: 'type-1' },
  project: { id: 'project-1' },
  nodeId: 'node-1',
  decidedBy: { id: 'user-2' },
  decidedAt: '2026-10-21T09:00:00.000Z',
  customFields: {
    '33333333-3333-4333-8333-333333333333': '2026-10-01',
    '22222222-2222-4222-8222-222222222222': 42,
  },
} as unknown as TaskListItem;

describe('taskRowValue — сырые ключи групп задач (#435)', () => {
  it('системные поля — теми же значениями, что и серверные выражения', () => {
    expect(taskRowValue(task, 'number')).toBe(7);
    expect(taskRowValue(task, 'title')).toBe('КЖ 1.1');
    expect(taskRowValue(task, 'stage')).toBe('stage-1');
    expect(taskRowValue(task, 'assignee')).toBe('user-1');
    expect(taskRowValue(task, 'project')).toBe('project-1');
    expect(taskRowValue(task, 'decidedBy')).toBe('user-2');
    expect(taskRowValue(task, 'folder')).toBe('node-1');
  });

  it('пустые ссылки — null (группа «без значения»)', () => {
    const bare = { ...task, assignee: null, project: null } as unknown as TaskListItem;
    expect(taskRowValue(bare, 'assignee')).toBeNull();
    expect(taskRowValue(bare, 'project')).toBeNull();
  });

  it('атрибуты: дата — текстом, число — числом, отсутствующий — null', () => {
    expect(taskRowValue(task, 'cf.33333333-3333-4333-8333-333333333333')).toBe('2026-10-01');
    expect(taskRowValue(task, 'cf.22222222-2222-4222-8222-222222222222')).toBe(42);
    expect(taskRowValue(task, 'cf.99999999-9999-4999-8999-999999999999')).toBeNull();
  });
});

describe('letterRowValue — сырые ключи групп писем', () => {
  const letter = {
    regNumber: 'Вх-2026/118',
    counterparty: { id: 'cp-1' },
    theirDate: '2026-10-05',
    addressee: { id: 'user-3' },
    typeId: 'type-letter-1',
    project: { id: 'project-1' },
    stage: { id: 'stage-l-1' },
  } as unknown as LetterListItem;

  it('колонки контракта соответствуют полям DTO', () => {
    expect(letterRowValue(letter, 'regNumber')).toBe('Вх-2026/118');
    expect(letterRowValue(letter, 'correspondent')).toBe('cp-1');
    expect(letterRowValue(letter, 'sentAt')).toBe('2026-10-05');
    expect(letterRowValue(letter, 'assignee')).toBe('user-3');
    expect(letterRowValue(letter, 'type')).toBe('type-letter-1');
    expect(letterRowValue(letter, 'stage')).toBe('stage-l-1');
  });
});

describe('folderRowValue — сырые ключи групп папок', () => {
  const folder = {
    name: 'КЖ-02',
    kindId: 'kind-1',
    createdAt: '2026-09-01T08:00:00.000Z',
  } as unknown as FolderListItem;

  it('системные поля папки', () => {
    expect(folderRowValue(folder, 'name')).toBe('КЖ-02');
    expect(folderRowValue(folder, 'kind')).toBe('kind-1');
    expect(folderRowValue(folder, 'createdAt')).toBe('2026-09-01T08:00:00.000Z');
  });
});
