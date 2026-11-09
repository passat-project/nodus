import { describe, expect, it } from 'vitest';
import type { EffectiveSection } from '@nodus/contracts';

import { buildExecuteBody } from './build-execute-body.js';
import { emptyDraft, type WindowDraft } from './use-window-draft.js';
import type { TransitionWindowContext } from './window-context.js';

const context: TransitionWindowContext = {
  entityId: 't1',
  conversationId: 'c1',
  currentStageName: 'В работе',
  fields: {
    description: 'Старое',
    deadline: '2026-10-30T10:00:00.000Z',
    assigneeId: 'bob',
    plannedMinutes: 60,
    customFields: {},
  },
  spentMinutes: 0,
  lastResult: { text: 'Прошлый итог', messageIds: ['m-old'] },
  access: { canEdit: true, canLogTime: true, canCheck: true },
  submission: null,
  scope: 'entity',
  customFieldDefinitions: [],
  customFieldRefs: [],
};

const draft = (patch: Partial<WindowDraft> = {}): WindowDraft => ({
  ...emptyDraft(context),
  ...patch,
});

const sections = (...kinds: EffectiveSection[]): EffectiveSection[] => kinds;

describe('buildExecuteBody (#380)', () => {
  it('отправляет только изменённые поля и не дублирует неизменённый итог', () => {
    const body = buildExecuteBody({
      sections: sections({
        kind: 'fields',
        fields: ['description', 'deadline'],
        elements: ['description', 'deadline'].map((key) => ({ key })) as never,
        gateKeys: [],
        origin: 'form',
      }),
      context,
      draft: draft({
        fields: {
          ...context.fields,
          description: 'Новое',
          deadline: '2026-11-01T10:00:00.000Z',
        },
      }),
    });
    expect(body).toEqual({
      form: {
        fields: { description: 'Новое', deadline: '2026-11-01T10:00:00.000Z' },
      },
    });
  });

  it('без раздела «Итог» текст берётся из прежней ревизии, переносятся её сообщения', () => {
    const body = buildExecuteBody({
      sections: sections({ kind: 'result_files', label: 'Акт', origin: 'form' }),
      context,
      draft: draft({ resultText: 'игнор', files: ['m-new'] }),
    });
    expect(body.form?.result).toEqual({
      text: 'Прошлый итог',
      messageIds: ['m-old', 'm-new'],
    });
  });

  it('итог не менялся — не отправляется; пустое тело — {}', () => {
    const body = buildExecuteBody({
      sections: sections({ kind: 'result', origin: 'form' }),
      context,
      draft: draft({ resultText: 'Прошлый итог' }),
    });
    expect(body).toEqual({});
  });

  it('время: режим if_empty при уже списанных минутах не отправляется', () => {
    const body = buildExecuteBody({
      sections: sections({ kind: 'time', mode: 'if_empty', origin: 'form' }),
      context: { ...context, spentMinutes: 30 },
      draft: draft({ time: { amount: '1ч', comment: '', daysAgo: 0 } }),
    });
    expect(body).toEqual({});
  });

  it('причина и время уходят; пустая причина — нет', () => {
    const body = buildExecuteBody({
      sections: sections(
        { kind: 'time', mode: 'always', origin: 'form' },
        { kind: 'comment', label: 'Причина', required: true, origin: 'form' },
      ),
      context,
      draft: draft({ time: { amount: '45м', comment: '', daysAgo: 0 }, comment: '  ' }),
    });
    expect(body.form?.time?.minutes).toBe(45);
    expect(body.form?.comment).toBeUndefined();
  });
});

describe('поля процесса в теле перехода (#431, Р7)', () => {
  const CF = '50000000-0000-4000-8000-000000000001';
  const CF_CLEARED = '50000000-0000-4000-8000-000000000002';

  it('уходят только изменённые значения; пустые и очистка — нет', () => {
    const body = buildExecuteBody({
      sections: sections({
        kind: 'fields',
        fields: [`cf.${CF}`, `cf.${CF_CLEARED}`],
        elements: [`cf.${CF}`, `cf.${CF_CLEARED}`].map((key) => ({ key })) as never,
        gateKeys: [],
        origin: 'form',
      }),
      context: {
        ...context,
        fields: { ...context.fields, customFields: { [CF_CLEARED]: 'было' } },
      },
      draft: draft({
        fields: {
          ...context.fields,
          customFields: { [CF]: '№ 12', [CF_CLEARED]: undefined as never },
        },
      }),
    });
    expect(body.form?.fields?.customFields).toEqual({ [CF]: '№ 12' });
  });

  it('поле вне окна не отправляется', () => {
    const body = buildExecuteBody({
      sections: sections({
        kind: 'fields',
        fields: ['deadline'],
        elements: ['deadline'].map((key) => ({ key })) as never,
        gateKeys: [],
        origin: 'form',
      }),
      context,
      draft: draft({
        fields: { ...context.fields, customFields: { [CF]: '№ 12' } },
      }),
    });
    expect(body).toEqual({});
  });

  it('пустой список формульного слота не уходит даже с always-send (A8-2)', () => {
    const body = buildExecuteBody({
      sections: sections({
        kind: 'fields',
        fields: [`cf.${CF}`],
        elements: [`cf.${CF}`].map((key) => ({ key })) as never,
        gateKeys: [],
        formulas: { [`cf.${CF}`]: { kind: 'literal', value: null } as never },
        origin: 'form',
      }),
      context,
      // Префилл материализовался в [] — грамматика поля (min 1) не пропустит.
      draft: draft({ fields: { ...context.fields, customFields: { [CF]: [] } } }),
    });
    expect(body).toEqual({});
  });
  it('раздел «Регистрация» (#55): валидный ввод хоста уходит целиком, неполный — нет', () => {
    const registration = {
      counterpartyId: '00000000-0000-4000-8000-000000000001',
      signerId: null,
      theirNumber: '0359-КЖ/152',
      theirDate: '2026-10-25',
      subject: 'О корректировке сроков',
      receiptMethodId: '00000000-0000-4000-8000-000000000002',
      projectId: null,
      addresseeId: '00000000-0000-4000-8000-000000000003',
      responseDeadline: null,
    };
    const only = sections({ kind: 'registration', origin: 'form' });
    expect(buildExecuteBody({ sections: only, context, draft: draft({ registration }) })).toEqual({
      form: { registration },
    });
    expect(buildExecuteBody({ sections: only, context, draft: draft() })).toEqual({});
    expect(
      buildExecuteBody({
        sections: sections({ kind: 'comment', label: 'Причина', required: true, origin: 'form' }),
        context,
        draft: draft({ registration, comment: 'Спам' }),
      }),
    ).toEqual({ form: { comment: 'Спам' } });
  });
});
