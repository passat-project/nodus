import { describe, expect, it } from 'vitest';

import type { TransitionForm } from './transition-form.schemas.js';
import {
  effectiveWindowSections,
  gateFixableBy,
  requiredWindowSections,
} from './transition-window.js';
import { workflowTransitionRulesSchema, type WorkflowValidator } from './workflow.schemas.js';

const form = (sections: TransitionForm['sections']): TransitionForm => ({
  enabled: true,
  sections,
});

const rules = (validators: WorkflowValidator[]) =>
  workflowTransitionRulesSchema.parse({ validators });

describe('раздел «Регистрация» письма (#55, O8)', () => {
  it('идёт первым в окне и обязателен для перехода без формы', () => {
    const sections = effectiveWindowSections(
      form([{ kind: 'comment', label: 'Причина', required: false }, { kind: 'registration' }]),
      rules([]),
    );
    expect(sections.map((s) => s.kind)).toEqual(['registration', 'comment']);
    expect(requiredWindowSections(sections)).toEqual(['registration']);
  });
});

describe('effectiveWindowSections (#380, Р4)', () => {
  it('окно выключено — только разделы из гейтов, в фиксированном порядке', () => {
    const sections = effectiveWindowSections(
      null,
      rules([
        { kind: 'time_logged' },
        { kind: 'result_files', min: 2 },
        { kind: 'fields_required', fields: ['deadline', 'result'] },
      ]),
    );
    expect(sections.map((s) => s.kind)).toEqual(['fields', 'time', 'result', 'result_files']);
    expect(sections.every((s) => s.origin === 'gate')).toBe(true);
  });

  it('настройка ∪ гейты: порядок блоков — из редактора, гейт добавляет в конец', () => {
    const sections = effectiveWindowSections(
      form([
        { kind: 'fields', fields: ['assignee'] },
        { kind: 'result_files', label: 'Акт' },
        { kind: 'comment', label: 'Причина', required: true },
      ]),
      rules([{ kind: 'fields_required', fields: ['deadline'] }, { kind: 'result_present' }]),
    );
    expect(sections.map((s) => s.kind)).toEqual(['fields', 'result_files', 'comment', 'result']);
    expect(sections[0]).toMatchObject({
      kind: 'fields',
      fields: ['assignee', 'deadline'],
      origin: 'form',
    });
    expect(sections[1]).toMatchObject({ kind: 'result_files', label: 'Акт', origin: 'form' });
    expect(sections[2]).toMatchObject({ kind: 'comment', label: 'Причина', required: true });
  });

  it('обязательные разделы окна — причина и сообщения, в порядке окна', () => {
    const sections = effectiveWindowSections(
      form([
        { kind: 'comment', label: 'Причина', required: true },
        { kind: 'result_messages', required: true },
      ]),
      rules([]),
    );
    expect(requiredWindowSections(sections)).toEqual(['comment', 'result_messages']);
  });
});

describe('gateFixableBy (#380)', () => {
  it('исправимые окном гейты и неисправимые', () => {
    expect(gateFixableBy('fields_required')).toBe('fields');
    expect(gateFixableBy('time_logged')).toBe('time');
    expect(gateFixableBy('result_present')).toBe('result');
    expect(gateFixableBy('result_files')).toBe('result_files');
    expect(gateFixableBy('no_open_subtasks')).toBeNull();
    expect(gateFixableBy('checklist_complete')).toBeNull();
  });
});

describe('effectiveWindowSections: кастомные поля (#431, Р7)', () => {
  const CF = '60000000-0000-4000-8000-000000000001';

  it('ключ cf.* живёт в тех же массивах, что системные поля', () => {
    const sections = effectiveWindowSections(
      form([{ kind: 'fields', fields: [`cf.${CF}`] }]),
      rules([{ kind: 'fields_required', fields: ['deadline', `cf.${CF}`] }]),
    );
    expect(sections[0]).toMatchObject({
      kind: 'fields',
      fields: [`cf.${CF}`, 'deadline'],
      origin: 'form',
    });
  });

  it('гейт с одним кастомным полем открывает раздел «Поля»', () => {
    const sections = effectiveWindowSections(
      null,
      rules([{ kind: 'fields_required', fields: [`cf.${CF}`] }]),
    );
    expect(sections[0]).toMatchObject({ kind: 'fields', origin: 'gate' });
  });
});
