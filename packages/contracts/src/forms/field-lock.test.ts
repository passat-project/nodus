import { describe, expect, it } from 'vitest';

import {
  buildCreationLocks,
  changedLockKeys,
  fieldLocksAfterChange,
  lockActorOf,
  lockDenialOf,
  lockFieldFilled,
  mergeLocks,
  type FieldLocks,
  type LockableValues,
} from './field-lock.js';
import { effectiveWindowSections, windowWritableKeys } from '../workflows/transition-window.js';
import type { TransitionForm } from '../workflows/transition-form.schemas.js';

/**
 * Замок записи (#496, Р4): одна грамматика сервера, моков и веба — что
 * считается изменением, кто правит закреплённое и какие ключи окна кнопки
 * пишутся мимо замка (В10).
 */

const VALUES: LockableValues = {
  title: 'Т',
  description: 'Описание',
  deadline: '2026-11-10T00:00:00.000Z',
  priority: 'normal',
  plannedMinutes: 60,
  assigneeId: 'bob',
  projectId: null,
  nodeId: null,
  customFields: { '11111111-1111-4111-8111-111111111111': 'значение' },
};

const LOCKS: FieldLocks = {
  deadline: {
    editors: 'none',
    lockedAt: '2026-11-09T00:00:00.000Z',
    lockedBy: 'alice',
    source: { kind: 'creation' },
  },
  assignee: {
    editors: 'owners',
    lockedAt: '2026-11-09T00:00:00.000Z',
    lockedBy: 'alice',
    source: { kind: 'transition', transitionId: 'tr-1', name: 'Выдать' },
  },
};

const actor = (id: string, permissions: string[] = []) => ({ id, permissions });

describe('changedLockKeys: замок — только на реальном изменении (Р4)', () => {
  it('то же значение, что в записи, — не изменение', () => {
    expect(changedLockKeys(VALUES, { deadline: VALUES.deadline, title: 'Т' })).toEqual([]);
  });

  it('срок и ответственный меняются — ключи карты Р4 (assignee → assigneeId)', () => {
    expect(
      changedLockKeys(VALUES, { deadline: null, assigneeId: 'kate', priority: 'high' }),
    ).toEqual(['deadline', 'priority', 'assignee']);
  });

  it('атрибут и перенос проекта (projectId+nodeId → project)', () => {
    expect(
      changedLockKeys(VALUES, {
        projectId: 'p-1',
        nodeId: 'n-1',
        customFields: { '11111111-1111-4111-8111-111111111111': 'новое' },
      }),
    ).toEqual(['project', 'cf.11111111-1111-4111-8111-111111111111']);
  });
});

describe('lockDenialOf: кто правит закреплённое (Р4)', () => {
  it('замок «никто» — отказ даже постановщику с причиной', () => {
    expect(
      lockDenialOf(LOCKS, ['deadline'], lockActorOf(actor('alice'), 'alice'), 'причина'),
    ).toEqual({ keys: ['deadline'], reason: 'locked' });
  });

  it('замок «постановщик»: не постановщик — owners_only, постановщик без причины — reason_required', () => {
    expect(lockDenialOf(LOCKS, ['assignee'], lockActorOf(actor('kate'), 'alice'))).toEqual({
      keys: ['assignee'],
      reason: 'owners_only',
    });
    // task.manage_any — «как постановщик» (Р12), причина всё равно нужна.
    const manager = lockActorOf(actor('kate', ['task.manage_any']), 'alice');
    expect(lockDenialOf(LOCKS, ['assignee'], manager)).toEqual({
      keys: ['assignee'],
      reason: 'reason_required',
    });
    expect(lockDenialOf(LOCKS, ['assignee'], manager, 'нужно')).toBeNull();
    const creator = lockActorOf(actor('alice'), 'alice');
    expect(lockDenialOf(LOCKS, ['assignee'], creator)).toEqual({
      keys: ['assignee'],
      reason: 'reason_required',
    });
    expect(lockDenialOf(LOCKS, ['assignee'], creator, 'нужно')).toBeNull();
  });

  it('право task.edit_locked — любой замок, но только с причиной', () => {
    const force = lockActorOf(actor('root', ['task.edit_locked']), 'alice');
    expect(lockDenialOf(LOCKS, ['deadline'], force)).toEqual({
      keys: ['deadline'],
      reason: 'reason_required',
    });
    expect(lockDenialOf(LOCKS, ['deadline'], force, 'форс-мажор')).toBeNull();
  });

  it('ключи окна кнопки (writable) пишутся мимо замка (В10)', () => {
    const force = lockActorOf(actor('kate'), 'alice');
    expect(
      lockDenialOf(LOCKS, ['assignee'], force, undefined, { writable: new Set(['assignee']) }),
    ).toBeNull();
  });

  it('незакреплённые ключи не проверяются', () => {
    expect(lockDenialOf(LOCKS, ['title'], lockActorOf(actor('kate'), 'alice'))).toBeNull();
  });
});

describe('fieldLocksAfterChange: след ручной правки', () => {
  it('пишет lastChange только закреплённым ключам, причина обрезается', () => {
    const next = fieldLocksAfterChange(LOCKS, ['assignee', 'title'], {
      at: '2026-11-09T12:00:00.000Z',
      by: 'alice',
      reason: '  сдвиг срока  ',
    });
    expect(next.assignee?.lastChange).toEqual({
      at: '2026-11-09T12:00:00.000Z',
      by: 'alice',
      reason: 'сдвиг срока',
    });
    expect(next.title).toBeUndefined();
    expect(next.deadline).toBe(LOCKS.deadline);
  });

  it('нечего менять — тот же объект (без записи колонки)', () => {
    expect(fieldLocksAfterChange(LOCKS, ['title'], { at: 'x', by: 'y', reason: 'z' })).toBe(LOCKS);
  });
});

describe('windowWritableKeys: окно кнопки пишет свои поля мимо замка (В10)', () => {
  const form = (): TransitionForm => ({
    enabled: true,
    sections: [
      { kind: 'fields', fields: [{ key: 'description' }, { key: 'deadline' }] },
      { kind: 'comment', label: 'Комментарий', required: false },
    ],
  });
  const sections = () =>
    effectiveWindowSections(form(), {
      validators: [{ kind: 'fields_required', fields: ['description', 'assignee'] }],
    });

  it('настроенные поля — всегда, поля условия — только пока пусты', () => {
    const keys = windowWritableKeys(sections(), (key) =>
      lockFieldFilled(key, {
        description: '',
        deadline: null,
        assigneeId: 'bob',
        plannedMinutes: null,
        hasResult: false,
        customFields: {},
      }),
    );
    expect([...keys].sort()).toEqual(['deadline', 'description'].sort());
  });

  it('поле условия заполнено — окно его не пишет', () => {
    const keys = windowWritableKeys(sections(), (key) =>
      lockFieldFilled(key, {
        description: 'Есть',
        deadline: null,
        assigneeId: 'bob',
        plannedMinutes: null,
        hasResult: false,
        customFields: {},
      }),
    );
    expect(keys.has('description')).toBe(true);
    expect(keys.has('assignee')).toBe(false);
  });

  it('нет раздела «Поля» — писать мимо замка нечего', () => {
    expect(
      windowWritableKeys(
        [{ kind: 'comment', label: 'К', required: true, origin: 'form' }],
        () => false,
      ).size,
    ).toBe(0);
  });
});

describe('lockFieldFilled: заполненность для условия (В10)', () => {
  it('скаляры и атрибуты', () => {
    const values = {
      description: ' ',
      deadline: null,
      assigneeId: null,
      plannedMinutes: 0,
      hasResult: false,
      customFields: {
        '11111111-1111-4111-8111-111111111111': [],
        '22222222-2222-4222-8222-222222222222': 5,
      },
    };
    expect(lockFieldFilled('description', values)).toBe(false);
    expect(lockFieldFilled('deadline', values)).toBe(false);
    expect(lockFieldFilled('assignee', values)).toBe(false);
    expect(lockFieldFilled('plannedMinutes', values)).toBe(true);
    expect(lockFieldFilled('result', values)).toBe(false);
    expect(lockFieldFilled('cf.11111111-1111-4111-8111-111111111111', values)).toBe(false);
    expect(lockFieldFilled('cf.22222222-2222-4222-8222-222222222222', values)).toBe(true);
    // Неизвестный ключ считается заполненным: окно права не получает.
    expect(lockFieldFilled('unknown', values)).toBe(true);
  });
});

describe('buildCreationLocks / mergeLocks: I-L8', () => {
  it('окно создания закрепляет все свои замки с источником «создание»', () => {
    const locks = buildCreationLocks(
      {
        locks: [
          { key: 'deadline', editors: 'owners' },
          { key: 'description', editors: 'none' },
        ],
      },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '2026-11-09T00:00:00.000Z',
    );
    expect(Object.keys(locks).sort()).toEqual(['deadline', 'description']);
    expect(locks.deadline).toMatchObject({
      editors: 'owners',
      source: { kind: 'creation' },
      lockedAt: '2026-11-09T00:00:00.000Z',
      lockedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });

  it('строже побеждает: none поверх owners заменяет запись, owners поверх none — нет', () => {
    const once = mergeLocks({}, [{ key: 'deadline', editors: 'owners' }], {
      lockedAt: '2026-11-09T00:00:00.000Z',
      lockedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source: { kind: 'creation' },
    });
    const stricter = mergeLocks(once, [{ key: 'deadline', editors: 'none' }], {
      lockedAt: '2026-11-09T01:00:00.000Z',
      lockedBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      source: {
        kind: 'transition',
        transitionId: '33333333-3333-4333-8333-333333333333',
        name: 'Выдать',
      },
    });
    expect(stricter.deadline).toMatchObject({
      editors: 'none',
      lockedAt: '2026-11-09T01:00:00.000Z',
      source: { kind: 'transition' },
    });
    expect(
      mergeLocks(stricter, [{ key: 'deadline', editors: 'owners' }], {
        lockedAt: '2026-11-09T02:00:00.000Z',
        lockedBy: null,
        source: { kind: 'creation' },
      }),
    ).toBe(stricter);
  });
});
