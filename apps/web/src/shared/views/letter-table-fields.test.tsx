// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CustomFieldDefinition, CustomFieldRef, LetterListItem } from '@nodus/contracts';

import type { AttributeRow } from '../custom-fields/attribute-carrier.js';

import { isResponseOverdue, makeLetterTableFields, theirReference } from './letter-table-fields.js';

/** Список писем: реквизиты корреспондента и срок ответа (#55) плюс
 *  атрибутные колонки (#632, Р9) — после системных, скрыты по умолчанию,
 *  значения по грамматике типа, формульное состояние — fx и бейдж «!». */

const FIELD = '55000000-0000-4000-8000-000000000021';
const LETTER_ID = '61000000-0000-4000-8000-000000000001';
const LETTER_TYPE = '20000000-0000-4000-8000-000000000910';
const REF_ID = '11000000-0000-4000-8000-000000000002';

function definition(extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: FIELD,
    number: 21,
    type: 'text',
    name: 'Шифр объекта',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [LETTER_TYPE], projectTypeIds: [], nodeKindIds: [] },
    processCategories: ['letter'],
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

const letterType = {
  id: LETTER_TYPE,
  code: 'letter_incoming',
  name: 'Входящее письмо',
  category: 'letter' as const,
  icon: 'inbox',
  color: 'info' as const,
};

function letterOf(extra: Partial<AttributeRow<LetterListItem>> = {}): AttributeRow<LetterListItem> {
  return {
    id: LETTER_ID,
    typeId: LETTER_TYPE,
    direction: 'incoming',
    stage: {
      id: '32000000-0000-4000-8000-000000000001',
      name: 'Зарегистрировано',
      order: 0,
      systemState: 'active',
      color: 'info',
      outcome: null,
    },
    regNumber: 'Вх-2026/118',
    regDate: '2026-11-01',
    registeredAt: '2026-11-01T09:00:00.000Z',
    receivedAt: '2026-11-01T08:00:00.000Z',
    source: 'mail',
    mailFromName: 'ОАО «Стройпроект»',
    mailFromAddress: 'office@stroy.by',
    subject: 'О согласовании АР',
    counterparty: null,
    theirNumber: '01-12/345',
    theirDate: '2026-10-20',
    receiptMethod: null,
    project: null,
    addressee: null,
    responseDeadline: null,
    replyTo: null,
    attachmentCount: 0,
    viewed: true,
    confidential: false,
    ...extra,
  };
}

afterEach(cleanup);

describe('реквизиты корреспондента (#55)', () => {
  it('№ и дата — «№ от ДД.ММ.ГГГГ», по отдельности — что есть', () => {
    expect(theirReference({ theirNumber: '01-12/345', theirDate: '2026-10-20' })).toBe(
      '01-12/345 от 20.10.2026',
    );
    expect(theirReference({ theirNumber: '01-12/345', theirDate: null })).toBe('01-12/345');
    expect(theirReference({ theirNumber: null, theirDate: '2026-10-20' })).toBe('от 20.10.2026');
    expect(theirReference({ theirNumber: null, theirDate: null })).toBe('');
  });
});

describe('срок ответа истёк (#55)', () => {
  const letter = (responseDeadline: string | null, systemState: 'active' | 'closed') => ({
    responseDeadline,
    stage: { systemState },
  });

  it('вчерашний срок у письма в работе — истёк; сегодняшний — ещё нет', () => {
    expect(isResponseOverdue(letter('2026-10-25', 'active'), '2026-10-26')).toBe(true);
    expect(isResponseOverdue(letter('2026-10-26', 'active'), '2026-10-26')).toBe(false);
  });

  it('закрытое письмо и письмо без срока срок не «жгут»', () => {
    expect(isResponseOverdue(letter('2026-10-01', 'closed'), '2026-10-26')).toBe(false);
    expect(isResponseOverdue(letter(null, 'active'), '2026-10-26')).toBe(false);
  });
});

describe('makeLetterTableFields: атрибутные колонки (#632, Р9)', () => {
  it('без определений колонок-атрибутов нет', () => {
    expect(makeLetterTableFields().some((f) => f.group === 'attributes')).toBe(false);
    expect(makeLetterTableFields({ box: 'incoming' }).some((f) => f.group === 'attributes')).toBe(
      false,
    );
  });

  it('атрибут письма добавлен последним, скрыт по умолчанию, без сортировки', () => {
    const fields = makeLetterTableFields({ definitions: [definition()] });
    const attributeField = fields.find((f) => f.id === `cf.${FIELD}`);
    expect(attributeField).toMatchObject({
      label: 'Шифр объекта',
      defaultVisible: false,
      group: 'attributes',
      defaultWidth: 160,
    });
    expect(attributeField?.sortValue).toBeUndefined();
    expect(fields[fields.length - 1]?.id).toBe(`cf.${FIELD}`);
  });

  it('ячейка показывает значение; пустое значение — пустая ячейка', () => {
    const fields = makeLetterTableFields({ definitions: [definition()] });
    const cell = fields.find((f) => f.id === `cf.${FIELD}`)!;

    render(<span>{cell.render(letterOf({ customFields: { [FIELD]: '0359-1' } }))}</span>);
    expect(screen.getByText('0359-1')).toBeTruthy();
    cleanup();

    // Список не пестрит «Не задано»: незаполненный атрибут — пустая ячейка.
    const { container } = render(<span>{cell.render(letterOf())}</span>);
    expect(container.textContent).toBe('');
  });

  it('ссылочный атрибут показывает имя из customFieldRefs строки', () => {
    const ref: CustomFieldRef = {
      kind: 'task',
      id: REF_ID,
      name: 'Согласовать АР',
      avatarUrl: null,
      archived: false,
    };
    const fields = makeLetterTableFields({
      definitions: [definition({ type: 'task', name: 'Задача по письму' })],
    });
    const cell = fields.find((f) => f.id === `cf.${FIELD}`)!;

    render(
      <span>
        {cell.render(letterOf({ customFields: { [FIELD]: REF_ID }, customFieldRefs: [ref] }))}
      </span>,
    );
    expect(screen.getByText('Согласовать АР')).toBeTruthy();
  });

  it('формульная ячейка — значок fx и бейдж ошибки без значения', () => {
    const fields = makeLetterTableFields({ definitions: [definition()] });
    const cell = fields.find((f) => f.id === `cf.${FIELD}`)!;

    render(
      <span>
        {cell.render(
          letterOf({
            customFieldFormulas: {
              [FIELD]: { origin: 'own', error: { code: 'division_by_zero', message: '÷0' } },
            },
          }),
        )}
      </span>,
    );
    expect(screen.getByText('fx')).toBeTruthy();
    expect(screen.getByLabelText('Ошибка формулы')).toBeTruthy();
  });

  it('атрибут задачи в список писем не попадает', () => {
    const taskAttribute = definition({ processCategories: ['task'] });
    expect(
      makeLetterTableFields({ definitions: [taskAttribute] }).some((f) => f.group === 'attributes'),
    ).toBe(false);
  });

  it('системные колонки письма остаются на месте (реестр не подменён)', () => {
    const fields = makeLetterTableFields({ definitions: [definition()], box: 'incoming' });
    expect(fields[0]?.id).toBe('regNumber');
    expect(fields.some((f) => f.id === 'subject')).toBe(true);
    expect(fields.filter((f) => f.group === 'attributes')).toHaveLength(1);
    // Тип письма-носителя демо-атрибута — категория «письмо» (фильтр Р9).
    expect(letterType.category).toBe('letter');
  });
});
