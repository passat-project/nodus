import { describe, expect, it } from 'vitest';

import type { CreationFieldSlot, CreationForm, CreationFormFacts } from './creation-form.js';
import {
  checkCreationForm,
  creationFormSchema,
  creationSlots,
  defaultCreationForm,
  effectiveCreationForm,
  isCreationValueFilled,
  presetAllowed,
  requiredAllowed,
  slotLabel,
} from './creation-form.js';
import type { CustomFieldDefinition } from '../custom-fields/custom-field.schemas.js';

/** Форма создания типа (#432): умолчание, толерантное чтение, правила
 *  слотов — по одному коду проблемы на правило. */

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

const facts = (over: Partial<CreationFormFacts> = {}): CreationFormFacts => ({
  category: 'task',
  customFields: {
    active: new Set(['11111111-1111-4111-8111-111111111111']),
    inType: new Set(['11111111-1111-4111-8111-111111111111']),
  },
  projectsAvailable: true,
  ...over,
});

const definition = (
  over: Partial<CustomFieldDefinition> = {},
): Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'> => ({
  id: '11111111-1111-4111-8111-111111111111',
  type: 'text',
  settings: {},
  ...over,
});

describe('форма создания: умолчание и чтение', () => {
  it('форма задачи по умолчанию — нынешняя экспресс-форма', () => {
    const form = defaultCreationForm('task');
    expect(creationSlots(form).map((f) => f.key)).toEqual([
      'description',
      'assignee',
      'deadline',
      'project',
    ]);
    expect(form.chips).toEqual(['checklist', 'planned']);
  });

  it('null и мусор читаются как умолчание, битая форма не роняет экран', () => {
    expect(effectiveCreationForm(null, 'task')).toEqual(defaultCreationForm('task'));
    expect(effectiveCreationForm({ fields: 'нет' }, 'task')).toEqual(defaultCreationForm('task'));
    expect(
      effectiveCreationForm(
        { fields: [slot('description', { required: true })], chips: [] },
        'task',
      ),
    ).toEqual({ fields: [slot('description', { required: true })], chips: [] });
  });

  it('правила слотов: обязательность и скрытое значение', () => {
    expect(requiredAllowed('assignee')).toBe(false);
    expect(requiredAllowed('priority')).toBe(false);
    expect(requiredAllowed('description')).toBe(true);
    expect(presetAllowed('deadline')).toBe(false);
    expect(presetAllowed('project')).toBe(true);
  });

  it('подпись: своё название важнее роли и стандартной подписи', () => {
    expect(slotLabel(slot('assignee', { label: 'Заявитель' }))).toBe('Заявитель');
    expect(slotLabel(slot('assignee'), { roleLabels: { assignee: 'Заявитель' } })).toBe(
      'Заявитель',
    );
    expect(slotLabel(slot('coexecutors'), { roleLabels: { coexecutor: 'Участники' } })).toBe(
      'Участники',
    );
    expect(slotLabel(slot('description'))).toBe('Описание');
    expect(
      slotLabel(slot('cf.11111111-1111-4111-8111-111111111111'), {
        definitions: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Причина' }],
      }),
    ).toBe('Причина');
  });
});

describe('checkCreationForm', () => {
  it('валидная форма без проблем', () => {
    const form: CreationForm = {
      fields: [slot('description', { required: true }), slot('assignee')],
      chips: ['checklist'],
    };
    expect(checkCreationForm(form, facts())).toEqual([]);
  });

  it('дубль поля', () => {
    const form: CreationForm = { fields: [slot('description'), slot('description')], chips: [] };
    expect(checkCreationForm(form, facts()).map((p) => p.code)).toEqual([
      'creation_duplicate_field',
    ]);
    expect(checkCreationForm(form, facts())[0]!.creationField).toBe('description');
  });

  it('«обязательно» у ответственного и приоритета запрещено', () => {
    const form: CreationForm = {
      fields: [slot('assignee', { required: true }), slot('priority', { required: true })],
      chips: [],
    };
    expect(checkCreationForm(form, facts()).map((p) => p.code)).toEqual([
      'creation_required_not_allowed',
      'creation_required_not_allowed',
    ]);
  });

  it('скрытое значение у срока запрещено', () => {
    const form: CreationForm = {
      fields: [slot('deadline', { preset: '2026-10-26T09:00:00.000Z' })],
      chips: [],
    };
    expect(checkCreationForm(form, facts()).map((p) => p.code)).toEqual([
      'creation_preset_not_allowed',
    ]);
  });

  it('обязательное и скрытое одновременно — ошибка', () => {
    const form: CreationForm = {
      fields: [slot('description', { required: true, preset: 'Причина' })],
      chips: [],
    };
    expect(checkCreationForm(form, facts()).map((p) => p.code)).toEqual([
      'creation_hidden_required',
    ]);
  });

  it('негодный пресет: несуществующий сотрудник и чужой тип значения', () => {
    const form: CreationForm = {
      fields: [
        slot('assignee', { preset: '22222222-2222-4222-8222-222222222222' }),
        slot('description', { preset: 42 }),
      ],
      chips: [],
    };
    expect(checkCreationForm(form, facts({ activeUserIds: new Set() })).map((p) => p.code)).toEqual(
      ['creation_preset_invalid', 'creation_preset_invalid'],
    );
  });

  it('пресет приоритета — только из закрытого набора', () => {
    const form: CreationForm = { fields: [slot('priority', { preset: 'supreme' })], chips: [] };
    expect(checkCreationForm(form, facts()).map((p) => p.code)).toEqual([
      'creation_preset_invalid',
    ]);
  });

  it('атрибут вне типа и неизвестный атрибут', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const other = '33333333-3333-4333-8333-333333333333';
    expect(
      checkCreationForm(
        { fields: [slot(`cf.${id}`)], chips: [] },
        facts({ customFields: { active: new Set([id]), inType: new Set() } }),
      ).map((p) => p.code),
    ).toEqual(['custom_field_not_in_type']);
    expect(
      checkCreationForm({ fields: [slot(`cf.${other}`)], chips: [] }, facts()).map((p) => p.code),
    ).toEqual(['custom_field_unknown']);
  });

  it('поле «Проект» недоступно без модуля проектов', () => {
    expect(
      checkCreationForm(
        { fields: [slot('project')], chips: [] },
        facts({ projectsAvailable: false }),
      ).map((p) => p.code),
    ).toEqual(['creation_field_unavailable']);
  });

  it('пресет атрибута проверяется типом определения', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const dateFacts = facts({ definitions: [definition({ id, type: 'date' })] });
    expect(
      checkCreationForm(
        { fields: [slot(`cf.${id}`, { preset: 'не дата' })], chips: [] },
        dateFacts,
      ).map((p) => p.code),
    ).toEqual(['creation_preset_invalid']);
    expect(
      checkCreationForm(
        { fields: [slot(`cf.${id}`, { preset: '2026-10-26' })], chips: [] },
        dateFacts,
      ),
    ).toEqual([]);
  });
});

describe('форма создания: границы схемы и замки окна (#496)', () => {
  it('больше 30 полей или 10 элементов оформления — схема не пропускает', () => {
    const tooManyFields = {
      fields: Array.from({ length: 31 }, () => slot('description')),
      chips: [],
    };
    expect(creationFormSchema.safeParse(tooManyFields).success).toBe(false);

    const tooMuchDecor = {
      fields: Array.from({ length: 11 }, (_, index) => ({
        kind: 'gap' as const,
        id: `dgap${String(index).padStart(5, '0')}`,
      })),
      chips: [],
    };
    expect(creationFormSchema.safeParse(tooMuchDecor).success).toBe(false);
  });

  it('пустое оформление, чужой ключ замка и атрибут вне типа — проблемы публикации', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const form: CreationForm = {
      fields: [slot('description'), { kind: 'heading', id: 'dhead001', text: '   ' }],
      chips: [],
      locks: [
        { key: 'bogus', editors: 'none' },
        { key: `cf.${id}`, editors: 'owners' },
      ],
    };
    expect(
      checkCreationForm(
        form,
        facts({
          customFields: {
            active: new Set([id]),
            inType: new Set<string>(),
          },
        }),
      ).map((p) => p.code),
    ).toEqual(['form_decor_empty', 'form_lock_key_invalid', 'form_lock_field_not_in_type']);
  });
});

describe('isCreationValueFilled', () => {
  it('пустое описание, пустой список участников и ноль', () => {
    expect(isCreationValueFilled('description', '  ')).toBe(false);
    expect(isCreationValueFilled('description', 'Причина')).toBe(true);
    expect(isCreationValueFilled('coexecutors', [])).toBe(false);
    expect(isCreationValueFilled('coexecutors', ['a'])).toBe(true);
    expect(isCreationValueFilled('cf.11111111-1111-4111-8111-111111111111', 0)).toBe(true);
    expect(isCreationValueFilled('deadline', null)).toBe(false);
  });
});
