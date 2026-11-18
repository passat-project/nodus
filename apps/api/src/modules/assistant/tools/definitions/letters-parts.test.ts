import { describe, expect, it, vi } from 'vitest';
import type { WorkflowAction } from '@nodus/contracts';

import { ALL_TOOLS, buildCatalog } from '../catalog.js';
import type { ToolContext } from '../tool-definition.js';
import {
  lettersActionsTool,
  lettersHistoryTool,
  lettersPartsReadTools,
} from './letters-parts.tools.js';
import {
  lettersAddParticipantTool,
  lettersJoinTool,
  lettersPartsWriteTools,
  lettersSetMainDocumentTool,
  lettersUpdateTool,
} from './letters-parts-write.tools.js';
import {
  lettersAddRelationTool,
  lettersPressActionTool,
} from './letters-relations-actions-write.tools.js';

/** #930: действия и история письма — карточки с именами, тела по контракту. */

const L = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333';
const U = '44444444-4444-4444-8444-444444444444';
const CP = '55555555-5555-4555-8555-555555555555';
const P = '66666666-6666-4666-8666-666666666666';
const ACT = '77777777-7777-4777-8777-777777777777';

const ctx: ToolContext = {
  authorization: 'Bearer t',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: vi.fn(async (path: string) => {
    if (path === `/letters/${L}`)
      return {
        id: L,
        regNumber: 'Вх-2026/118',
        subject: 'Акт согласован',
        attachments: [{ id: A, name: 'Акт.pdf' }],
      };
    if (path === `/letters/${OTHER}`) return { id: OTHER, regNumber: null, subject: 'Запрос' };
    if (path === `/counterparties/${CP}`) return { id: CP, shortName: 'Стройпроект' };
    if (path === `/projects/${P}`) return { id: P, name: 'Северный' };
    if (path === `/directory/users/${U}`) return { id: U, displayName: 'Петров Пётр' };
    if (path === `/letters/${L}/actions`)
      return [
        {
          id: ACT,
          name: 'Ознакомить',
          display: 'button',
          form: { enabled: false, sections: [] },
          blockedBy: [],
          validators: [],
        },
      ];
    return null;
  }),
};

describe('чтение действий и истории', () => {
  it('действия: имя, id, блокировка и окно ввода', () => {
    const text = lettersActionsTool.project!(
      [
        {
          id: ACT,
          name: 'Ознакомить',
          display: 'button',
          form: { enabled: false, sections: [] },
          blockedBy: [],
          validators: [],
        },
        {
          id: OTHER,
          name: 'Запросить',
          display: 'button',
          form: { enabled: true, sections: [] },
          blockedBy: [{ kind: 'fields_required', fields: ['cf.x'] }],
          validators: [],
        },
      ] as WorkflowAction[],
      { letterId: L },
    ).text;
    expect(text).toContain('Ознакомить · id');
    expect(text).toContain('окно ввода');
    expect(text).toContain('не заполнены обязательные поля');
  });

  it('история: автор, стадия и следующая страница', () => {
    const text = lettersHistoryTool.project!(
      {
        items: [
          {
            id: 'h1',
            at: '2026-11-18T10:00:00.000Z',
            actor: { id: U, displayName: 'Петров Пётр' },
            kind: 'stage_changed',
            transitionName: 'Зарегистрировать',
            fromStageName: 'Новое',
            toStageName: 'В работе',
          },
          {
            id: 'h2',
            at: '2026-11-17T09:00:00.000Z',
            actor: null,
            kind: 'received',
            source: 'mail',
          },
        ],
        nextCursor: 'c2',
      } as never,
      { letterId: L, limit: 30 },
    ).text;
    expect(text).toContain('Петров Пётр');
    expect(text).toContain('«Новое» → «В работе»');
    expect(text).toContain('система');
    expect(text).toContain('есть следующая страница');
  });
});

describe('правка реквизитов', () => {
  it('тело — ровно patch, карточка показывает имена и даты', async () => {
    const input = {
      letterId: L,
      patch: {
        subject: 'Акт согласован',
        counterpartyId: CP,
        projectId: P,
        responseDeadline: '2026-11-25',
        confidential: true,
      },
    };
    expect(lettersUpdateTool.build!(input)).toEqual({
      method: 'PATCH',
      path: `/letters/${L}`,
      body: input.patch,
    });
    const fields = await lettersUpdateTool.card!.fields(input, ctx);
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: 'Письмо', value: '№Вх-2026/118 «Акт согласован»' },
        { label: 'Контрагент', value: 'Стройпроект' },
        { label: 'Проект', value: 'Северный' },
        { label: 'Конфиденциально', value: 'да' },
      ]),
    );
    expect(lettersUpdateTool.card!.undo).toBeUndefined();
  });
});

describe('основной документ и участники', () => {
  it('основной документ: имя файла из письма', async () => {
    const input = { letterId: L, attachmentId: A };
    expect(lettersSetMainDocumentTool.build!(input)).toEqual({
      method: 'POST',
      path: `/letters/${L}/main-document`,
      body: { attachmentId: A },
    });
    expect(await lettersSetMainDocumentTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([{ label: 'Документ', value: 'Акт.pdf' }]),
    );
  });

  it('участники: имена вместо id, тело по контракту', async () => {
    const input = { letterId: L, userIds: [U] };
    expect(lettersAddParticipantTool.build!(input)).toEqual({
      method: 'POST',
      path: `/letters/${L}/participants`,
      body: { userIds: [U] },
    });
    expect(await lettersAddParticipantTool.card!.summary(input, ctx)).toContain('Петров Пётр');
  });

  it('присоединение — отдельное действие без входных полей', () => {
    expect(lettersJoinTool.build!({ letterId: L })).toEqual({
      method: 'POST',
      path: `/letters/${L}/join`,
    });
  });
});

describe('связи и действия маршрута', () => {
  it('связь: вид и вторая сторона человеческими словами', async () => {
    const input = { letterId: L, relatedLetterId: OTHER, kind: 'reply_to' as const };
    expect(lettersAddRelationTool.build!(input)).toEqual({
      method: 'POST',
      path: `/letters/${L}/relations`,
      body: { relatedLetterId: OTHER, kind: 'reply_to' },
    });
    const summary = await lettersAddRelationTool.card!.summary(input, ctx);
    expect(summary).toContain('ответ на');
    expect(summary).toContain('№Вх-2026/118');
    expect(summary).toContain('«Запрос»');
  });

  it('нажатие действия: карточка называет кнопку, тело несёт форму', async () => {
    const input = {
      letterId: L,
      actionId: ACT,
      reason: 'Ознакомлен',
      form: { fields: { comment: 'ок' } },
    };
    expect(lettersPressActionTool.build!(input)).toEqual({
      method: 'POST',
      path: `/letters/${L}/actions/${ACT}/press`,
      body: { reason: 'Ознакомлен', form: { fields: { comment: 'ок' } } },
    });
    expect(await lettersPressActionTool.card!.summary(input, ctx)).toContain('Ознакомить');
  });
});

describe('права каталога', () => {
  it('без права регистрации изменяющие действия письма не выдаются', () => {
    const catalog = buildCatalog({
      permissions: ['assistant.use'],
      features: ['correspondence'],
    });
    const ids = catalog.map((tool) => tool.id);
    expect(ids).toContain('letters.actions');
    expect(ids).toContain('letters.history');
    expect(ids).toContain('letters.join');
    expect(ids).not.toContain('letters.update');
    expect(ids).not.toContain('letters.add_participant');
    expect(ids).not.toContain('letters.set_main_document');
    expect(ids).not.toContain('letters.add_relation');
  });

  it('все write-инструменты партии имеют карточку', () => {
    for (const tool of [...lettersPartsReadTools, ...lettersPartsWriteTools]) {
      expect(ALL_TOOLS.some((item) => item.id === tool.id)).toBe(true);
      if (tool.kind === 'write') expect(tool.card, tool.id).toBeTruthy();
    }
  });
});
