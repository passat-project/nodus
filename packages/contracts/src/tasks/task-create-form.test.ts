import { describe, expect, it } from 'vitest';

import type { CreateTaskBody } from './task.schemas.js';
import {
  applyCreationPresets,
  clearedRequiredKeys,
  createBodyValue,
  missingCreateFields,
  requiredCreateKeys,
  withCreateBodyValue,
} from './task-create-form.js';
import type { CreationFieldSlot, CreationForm } from '../workflows/creation-form.js';

/** Форма создания ↔ тело POST /tasks (#432): скрытые значения важнее
 *  введённого, «не хватает» — после умолчаний, очистка обязательного. */

const slot = (
  key: CreationFieldSlot['key'],
  extra: Partial<CreationFieldSlot> = {},
): CreationFieldSlot => ({
  key,
  label: null,
  required: false,
  preset: null,
  ...extra,
});

describe('createBodyValue / withCreateBodyValue', () => {
  it('ключи слотов ложатся в поля тела создания', () => {
    const body: CreateTaskBody = {
      title: 'Переработка',
      description: 'Причина',
      assigneeId: 'a',
      coexecutorIds: ['b'],
      deadline: '2026-10-26T09:00:00.000Z',
      priority: 'high',
      projectId: 'p',
    };
    expect(createBodyValue('description', body)).toBe('Причина');
    expect(createBodyValue('assignee', body)).toBe('a');
    expect(createBodyValue('coexecutors', body)).toEqual(['b']);
    expect(createBodyValue('deadline', body)).toBe('2026-10-26T09:00:00.000Z');
    expect(createBodyValue('priority', body)).toBe('high');
    expect(createBodyValue('project', body)).toBe('p');
  });

  it('атрибут живёт в customFields по id определения', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const body = withCreateBodyValue({ title: 'Т' }, `cf.${id}`, 4);
    expect(body.customFields).toEqual({ [id]: 4 });
    expect(createBodyValue(`cf.${id}`, body)).toBe(4);
  });
});

describe('applyCreationPresets', () => {
  it('значение формы важнее введённого (Р4)', () => {
    const form: CreationForm = {
      fields: [slot('assignee', { preset: 'form-user' }), slot('description')],
      chips: [],
    };
    const body = applyCreationPresets(form, { title: 'Т', assigneeId: 'typed-user' });
    expect(body.assigneeId).toBe('form-user');
    expect(body.description).toBeUndefined();
  });
});

describe('missingCreateFields', () => {
  const form: CreationForm = {
    fields: [
      slot('description', { required: true }),
      slot('deadline', { required: true }),
      slot('assignee', { preset: 'form-user' }),
      slot('project', { required: true }),
    ],
    chips: [],
  };

  it('перечисляет только незаполненные обязательные поля', () => {
    expect(missingCreateFields(form, { title: 'Т', description: 'Причина' })).toEqual([
      'deadline',
      'project',
    ]);
  });

  it('умолчания сервера считаются заполненными', () => {
    expect(
      missingCreateFields(
        form,
        { title: 'Т', description: 'Причина', projectId: 'p' },
        { defaultsFilled: new Set(['deadline']) },
      ),
    ).toEqual([]);
  });

  it('скрытые поля в обязательные не попадают', () => {
    expect(requiredCreateKeys(form)).toEqual(['description', 'deadline', 'project']);
  });
});

describe('clearedRequiredKeys', () => {
  it('очистка обязательного — ошибка, отсутствующий ключ не трогается', () => {
    expect(
      clearedRequiredKeys(['description', 'deadline', 'coexecutors'], {
        description: '   ',
        coexecutors: ['a'],
      }),
    ).toEqual(['description']);
    expect(clearedRequiredKeys(['description'], { deadline: null })).toEqual([]);
  });
});
