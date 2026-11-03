import { describe, expect, it } from 'vitest';
import type { EffectiveSection, WorkflowTransition } from '@nodus/contracts';

import { emptyDraft } from './use-window-draft.js';
import { windowCanSubmit, windowConditionLines } from './window-conditions.js';
import type { TransitionWindowContext } from './window-context.js';

const context: TransitionWindowContext = {
  entityId: 't1',
  conversationId: 'c1',
  currentStageName: 'В работе',
  fields: {
    description: '',
    deadline: null,
    assigneeId: 'bob',
    plannedMinutes: null,
    customFields: {},
  },
  spentMinutes: 0,
  lastResult: null,
  access: { canEdit: true, canLogTime: true, canCheck: true },
  submission: null,
  scope: 'entity',
  customFieldDefinitions: [],
  customFieldRefs: [],
};

const transition = (patch: Partial<WorkflowTransition>): WorkflowTransition => ({
  id: 't',
  name: 'Завершить',
  toStageId: 's2',
  toStageName: 'Завершена',
  toStageState: 'closed',
  toStageOutcome: 'success',
  toStageColor: 'info',
  toStageOrder: 1,
  display: 'primary',
  intent: 'action',
  blockedBy: [],
  canOverride: false,
  form: null,
  validators: [],
  ...patch,
});

const section = (...items: EffectiveSection[]) => items;

describe('живые условия окна (#380)', () => {
  it('поля: дозаполнение в окне снимает гейт', () => {
    const t = transition({
      validators: [{ kind: 'fields_required', fields: ['deadline', 'description'] }],
      blockedBy: [{ kind: 'fields_required', fields: ['deadline', 'description'] }],
    });
    const empty = windowConditionLines({
      transition: t,
      context,
      draft: emptyDraft(context),
      attachmentCount: 0,
    });
    expect(empty[0]?.ok).toBe(false);
    const filled = windowConditionLines({
      transition: t,
      context,
      draft: {
        ...emptyDraft(context),
        fields: {
          description: 'Описание',
          deadline: '2026-10-30T10:00:00.000Z',
          assigneeId: 'bob',
          plannedMinutes: null,
          customFields: {},
        },
      },
      attachmentCount: 0,
    });
    expect(filled[0]?.ok).toBe(true);
  });

  it('файлы итога: считается Σ вложений; подзадачи неисправимы', () => {
    const t = transition({
      validators: [{ kind: 'result_files', min: 2 }, { kind: 'no_open_subtasks' }],
      blockedBy: [
        { kind: 'result_files', count: 1, min: 2 },
        { kind: 'no_open_subtasks', count: 1 },
      ],
    });
    const lines = windowConditionLines({
      transition: t,
      context,
      draft: emptyDraft(context),
      attachmentCount: 1,
    });
    expect(lines[0]).toMatchObject({ ok: false, fixable: true });
    expect(lines[1]).toMatchObject({ ok: false, fixable: false });
  });

  it('главная кнопка: обязательная причина и сообщения держат отправку', () => {
    const sections = section(
      { kind: 'comment', label: 'Причина', required: true, origin: 'form' },
      { kind: 'result_messages', required: true, origin: 'form' },
    );
    const base = emptyDraft(context);
    expect(windowCanSubmit({ sections, lines: [], draft: base })).toBe(false);
    expect(
      windowCanSubmit({
        sections,
        lines: [],
        draft: { ...base, comment: 'Причина', messages: ['m1'] },
      }),
    ).toBe(true);
  });

  it('незакрытый гейт держит кнопку', () => {
    const sections = section({ kind: 'result', origin: 'gate' });
    const base = emptyDraft(context);
    const t = transition({ validators: [{ kind: 'result_present' }] });
    const emptyLines = windowConditionLines({
      transition: t,
      context,
      draft: base,
      attachmentCount: 0,
    });
    expect(windowCanSubmit({ sections, lines: emptyLines, draft: base })).toBe(false);
    const filled = { ...base, resultText: 'Сделано' };
    const filledLines = windowConditionLines({
      transition: t,
      context,
      draft: filled,
      attachmentCount: 0,
    });
    expect(windowCanSubmit({ sections, lines: filledLines, draft: filled })).toBe(true);
  });
});

describe('поля процесса в условиях окна (#431, Р7)', () => {
  const CF = '50000000-0000-4000-8000-000000000001';
  const CF_MISSING = '50000000-0000-4000-8000-000000000002';

  it('ключ cf.* считается по черновику; архивный/неизвестный не блокирует', () => {
    const t = transition({
      validators: [{ kind: 'fields_required', fields: [`cf.${CF}`, `cf.${CF_MISSING}`] }],
    });
    const empty = windowConditionLines({
      transition: t,
      context,
      draft: emptyDraft(context),
      attachmentCount: 0,
    });
    expect(empty[0]?.ok).toBe(false);
    const filled = windowConditionLines({
      transition: t,
      context,
      draft: {
        ...emptyDraft(context),
        fields: { ...context.fields, customFields: { [CF]: '№ 12' } },
      },
      attachmentCount: 0,
    });
    // Второй ключ неизвестен контексту — но окно считает его пустым; сервер
    // пропускает неактивные определения, здесь проверяем заполнение первого.
    expect(filled[0]?.ok).toBe(false);
    const onlyKnown = windowConditionLines({
      transition: transition({ validators: [{ kind: 'fields_required', fields: [`cf.${CF}`] }] }),
      context,
      draft: {
        ...emptyDraft(context),
        fields: { ...context.fields, customFields: { [CF]: '№ 12' } },
      },
      attachmentCount: 0,
    });
    expect(onlyKnown[0]?.ok).toBe(true);
  });
});
