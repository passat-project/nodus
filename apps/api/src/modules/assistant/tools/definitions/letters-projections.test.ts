/**
 * Проекции инструментов писем (#892, #896): реестр, карточка, переходы,
 * дерево связей и опись вложений. Тест держит формы контрактов
 * корреспонденции: плоский `{ root, truncated }`, `relationKind`,
 * `role`/`inline` у вложений и «контент не читается» (только метаданные).
 */

import { describe, expect, it } from 'vitest';

import {
  lettersAttachmentsTool,
  lettersGetTool,
  lettersListTool,
  lettersRelationsTool,
  lettersTransitionsTool,
} from './letters.tools.js';

const LETTER_ID = '22222222-2222-4222-8222-222222222222';

describe('letters.list / letters.get: реестр и карточка (#892)', () => {
  const row = {
    id: LETTER_ID,
    regNumber: 'Вх-2026/118',
    subject: 'О согласовании проекта',
    direction: 'outgoing',
    stage: { name: 'На резолюции' },
    counterparty: { name: 'ООО Стройтрест' },
    regDate: '2026-02-03T00:00:00.000Z',
    responseDeadline: '2026-02-20T00:00:00.000Z',
    attachmentCount: 3,
    confidential: true,
  };

  it('строка реестра: номер, тема, направление, стадия, корреспондент, сроки, вложения', () => {
    const { text } = lettersListTool.project!({ items: [row] }, {});
    expect(text).toContain('Письма: 1');
    expect(text).toContain('№Вх-2026/118, «О согласовании проекта»');
    expect(text).toContain('направление исходящее');
    expect(text).toContain('стадия «На резолюции»');
    expect(text).toContain('корреспондент «ООО Стройтрест»');
    expect(text).toContain('дата 3 фев 2026');
    expect(text).toContain('срок ответа 20 фев 2026');
    expect(text).toContain('вложений 3');
    expect(text).toContain('КОНФИДЕНЦИАЛЬНО');
    expect(text).toContain(`id ${LETTER_ID}`);
  });

  it('строка без номера — «без номера», без темы — «(без темы)»', () => {
    const { text } = lettersListTool.project!(
      { items: [{ id: LETTER_ID, direction: 'incoming', stage: null }] },
      {},
    );
    expect(text).toContain('без номера, (без темы), направление входящее');
    expect(text).toContain('стадия «—»');
  });

  it('пропускает строки без id; неизвестный реестр — пусто', () => {
    expect(lettersListTool.project!({ items: [{ subject: 'без id' }] }, {}).text).toBe(
      'Письма: 0\n(пусто)',
    );
    expect(
      lettersListTool.project!({ items: [{ id: LETTER_ID }], nextCursor: 'c' }, {}).text,
    ).toContain('есть следующая страница (cursor)');
  });

  it('запрос реестра передаёт box и только заданные фильтры', () => {
    expect(
      lettersListTool.build!({ box: 'new', search: 'смета', counterpartyId: LETTER_ID, limit: 10 }),
    ).toEqual({
      path: '/letters',
      query: { box: 'new', limit: '10', search: 'смета', counterpartyId: LETTER_ID },
    });
    expect(lettersListTool.build!({ box: 'outgoing', limit: 20 })).toEqual({
      path: '/letters',
      query: { box: 'outgoing', limit: '20' },
    });
  });

  it('карточка письма: адресат, номер корреспондента, сроки и опись вложений', () => {
    const { text, entity } = lettersGetTool.project!(
      {
        ...row,
        addressee: { displayName: 'Директору' },
        theirNumber: '77/12',
        theirDate: '2026-01-30T00:00:00.000Z',
        attachments: [
          {
            name: 'Договор.pdf',
            mime: 'application/pdf',
            size: 512_000,
            role: 'main',
            inline: false,
            url: '/secret',
          },
          { name: 'Скан.png', mime: 'image/png', size: null },
          null,
        ],
      },
      { id: LETTER_ID },
    );
    expect(text).toContain(`№Вх-2026/118 «О согласовании проекта» (id ${LETTER_ID})`);
    expect(text).toContain('Направление: исходящее');
    expect(text).toContain('Корреспондент: ООО Стройтрест');
    expect(text).toContain('Адресат: Директору');
    expect(text).toContain('Номер и дата корреспондента: 77/12 от 30 янв 2026');
    expect(text).toContain('Дата регистрации: 3 фев 2026');
    expect(text).toContain('Срок ответа: 20 фев 2026');
    expect(text).toContain('Признак: КОНФИДЕНЦИАЛЬНО');
    expect(text).toContain('Вложений: 3');
    expect(text).toContain('— Договор.pdf, application/pdf, 500 КБ');
    expect(text).toContain('— Скан.png, image/png, размер неизвестен');
    expect(text).not.toContain('/secret');
    expect(entity).toEqual({ href: `?cards=letter:${LETTER_ID}`, label: 'Вх-2026/118' });
  });

  it('незарегистрированное письмо без адресата и без вложений', () => {
    const { text } = lettersGetTool.project!(
      { id: LETTER_ID, direction: 'incoming', stage: null },
      { id: LETTER_ID },
    );
    expect(text).toContain('Без номера «(без темы)»');
    expect(text).toContain('Адресат: —');
    expect(text).toContain('Дата регистрации: не зарегистрировано');
    expect(text).toContain('Срок ответа: не задан');
    expect(text).toContain('Признак: обычное');
    expect(text).toContain('Вложений: 0');
  });

  it('письмо без id — «не найдено»', () => {
    expect(lettersGetTool.project!({ regNumber: 'x' }, { id: LETTER_ID }).text).toBe(
      'Письмо не найдено или недоступно',
    );
    expect(lettersGetTool.build!({ id: LETTER_ID })).toEqual({ path: `/letters/${LETTER_ID}` });
  });
});

describe('letters.transitions / relations / attachments (#892)', () => {
  it('переходы показывают блокировки и обход с причиной', () => {
    const { text } = lettersTransitionsTool.project!(
      [
        { name: 'Зарегистрировать', toStageName: 'Входящее' },
        { name: 'Дать резолюцию', toStageName: 'На исполнении', blockedBy: ['a', 'b'] },
        { name: 'Закрыть', toStageName: 'Завершено', canOverride: true },
        null,
      ],
      { id: LETTER_ID },
    );
    expect(text).toContain('«Зарегистрировать» → стадия «Входящее»');
    expect(text).toContain('(заблокировано: 2)');
    expect(text).toContain('обходимо с причиной');
    expect(lettersTransitionsTool.build!({ id: LETTER_ID })).toEqual({
      path: `/letters/${LETTER_ID}/transitions`,
    });
  });

  it('связи обходят дерево в глубину и помечают ответы и обрезку', () => {
    const { text } = lettersRelationsTool.project!(
      {
        root: {
          id: LETTER_ID,
          children: [
            {
              regNumber: 'Вх-2',
              subject: 'Ответ',
              relationKind: 'reply_to',
              children: [{ regNumber: null, subject: null, relationKind: 'other', children: [] }],
            },
            { regNumber: 'Вх-3', subject: 'Сопроводительное', relationKind: 'linked' },
            null,
          ],
        },
        truncated: true,
      },
      { id: LETTER_ID },
    );
    expect(text).toContain('Связанные письма: 4');
    expect(text).toContain('№Вх-2 «Ответ» — ответ');
    expect(text).toContain('  без номера «(без темы)» — вложено в цепочку');
    expect(text).toContain('№Вх-3 «Сопроводительное» — вложено в цепочку');
    expect(text).toContain('дерево обрезано');
    expect(lettersRelationsTool.build!({ id: LETTER_ID })).toEqual({
      path: `/letters/${LETTER_ID}/tree`,
    });
  });

  it('связей нет — пустой блок; запрос описи берёт карточку письма', () => {
    expect(lettersRelationsTool.project!({ root: { children: [] } }, { id: LETTER_ID }).text).toBe(
      'Связанные письма: 0\n(пусто)',
    );
    expect(lettersAttachmentsTool.build!({ id: LETTER_ID })).toEqual({
      path: `/letters/${LETTER_ID}`,
    });
  });

  it('роли вложений: PDF тела, встроенное, обычное, неизвестный размер', () => {
    const { text, entity } = lettersAttachmentsTool.project!(
      {
        id: LETTER_ID,
        attachments: [
          { name: 'body.pdf', mime: 'application/pdf', size: 2048, role: 'body_pdf' },
          { name: 'logo.png', mime: 'image/png', size: 1024, role: 'attachment', inline: true },
          { name: 'note.txt', mime: 'text/plain', size: 0, role: 'attachment' },
          null,
        ],
      },
      { id: LETTER_ID },
    );
    expect(text).toContain('body.pdf, application/pdf, 2 КБ, PDF-копия тела');
    expect(text).toContain('logo.png, image/png, 1 КБ, встроено в тело');
    expect(text).toContain('note.txt, text/plain, 0 КБ, вложение');
    expect(entity).toEqual({ href: `?cards=letter:${LETTER_ID}`, label: 'Письмо' });
  });
});
