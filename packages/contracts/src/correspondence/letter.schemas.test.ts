import { describe, expect, it } from 'vitest';

import {
  createLetterFieldsSchema,
  letterBodySchema,
  letterDetailSchema,
  letterHistoryEntrySchema,
  letterRefSchema,
  letterRelationCreateBodySchema,
  letterTreeResponseSchema,
  listLettersQuerySchema,
  updateLetterBodySchema,
} from './letter.schemas.js';

const id = () => crypto.randomUUID();

const listItem = {
  id: id(),
  typeId: id(),
  direction: 'incoming',
  stage: { id: id(), name: 'Новое', order: 0, systemState: 'backlog', color: 'neutral' },
  regNumber: null,
  regDate: null,
  registeredAt: null,
  receivedAt: '2026-10-26T07:12:00.000Z',
  source: 'manual',
  mailFromName: null,
  mailFromAddress: null,
  subject: null,
  counterparty: null,
  theirNumber: null,
  theirDate: null,
  receiptMethod: null,
  project: null,
  addressee: null,
  responseDeadline: null,
  replyTo: null,
  attachmentCount: 1,
  viewed: false,
  confidential: false,
};

describe('письмо v3 (#55)', () => {
  it('незарегистрированный бумажный скан: без темы, номера и корреспондента', () => {
    const fileId = id();
    const attachmentId = id();
    const detail = letterDetailSchema.parse({
      ...listItem,
      type: {
        id: listItem.typeId,
        code: 'letter-incoming',
        name: 'Входящее письмо',
        category: 'letter',
        icon: 'send',
        color: 'info',
      },
      signer: null,
      registrar: null,
      mail: null,
      replySuggestion: null,
      counterpartySuggestion: null,
      attachments: [
        {
          id: attachmentId,
          fileId,
          role: 'main',
          name: 'скан.jpg',
          mime: 'image/jpeg',
          size: 120_000,
          contentId: null,
          inline: false,
          url: '/api/v1/files/x/content?exp=1&sig=2',
          pdfUrl: null,
          previewKind: 'image',
        },
      ],
      body: { kind: 'document', attachmentId },
      customFields: {},
      customFieldRefs: [],
      attachedRefs: [],
      canManageRelations: false,
      access: { canEdit: false, canDeleteSpam: true, canJoin: true, isParticipant: false },
    });
    expect(detail.subject).toBeNull();
    expect(detail.body).toEqual({ kind: 'document', attachmentId });
  });

  it('тело — закрытый union (текст только PDF-копией, #56); ссылка допускает пустую тему', () => {
    expect(letterBodySchema.parse({ kind: 'none' })).toEqual({ kind: 'none' });
    expect(() => letterBodySchema.parse({ kind: 'html' })).toThrow();
    expect(() => letterBodySchema.parse({ kind: 'text' })).toThrow();
    expect(
      letterRefSchema.parse({ id: listItem.id, regNumber: null, subject: null }).subject,
    ).toBeNull();
  });

  it('правка одного поля не подставляет чужие ключи (gotcha Zod 4)', () => {
    expect(updateLetterBodySchema.parse({ subject: ' Новая тема ' })).toEqual({
      subject: 'Новая тема',
    });
    expect(updateLetterBodySchema.parse({ signerId: null })).toEqual({ signerId: null });
    expect(updateLetterBodySchema.safeParse({}).success).toBe(false);
    // Номер правкой не меняется никогда; адресат — только до регистрации.
    expect(updateLetterBodySchema.safeParse({ addresseeId: id() }).success).toBe(true);
    expect(updateLetterBodySchema.safeParse({ addresseeId: null }).success).toBe(true);
    expect(updateLetterBodySchema.safeParse({ regNumber: 'Вх-2026/1' }).success).toBe(false);
  });

  it('поля multipart ручного создания: главный — первый по умолчанию, строки приводятся', () => {
    const typeId = id();
    expect(createLetterFieldsSchema.parse({ typeId })).toEqual({ typeId, mainIndex: 0 });
    expect(createLetterFieldsSchema.parse({ typeId, mainIndex: '3' }).mainIndex).toBe(3);
    expect(createLetterFieldsSchema.safeParse({ typeId, mainIndex: '20' }).success).toBe(false);
  });

  it('запрос списка: вкладка, корреспондент, поиск 1–128', () => {
    expect(listLettersQuerySchema.parse({ box: 'new' }).box).toBe('new');
    expect(listLettersQuerySchema.safeParse({ box: 'registry' }).success).toBe(false);
    expect(listLettersQuerySchema.safeParse({ search: 'я'.repeat(129) }).success).toBe(false);
  });

  it('почтовое письмо (#56): конверт, подсказки, inline-вложение с contentId', () => {
    const attachmentId = id();
    const outgoingRef = { id: id(), regNumber: 'Исх-2026/45', subject: 'Проект договора' };
    const detail = letterDetailSchema.parse({
      ...listItem,
      source: 'mail',
      mailFromName: 'ООО «Силиум»',
      mailFromAddress: 'info@silium.by',
      replyTo: outgoingRef,
      type: {
        id: listItem.typeId,
        code: 'letter-incoming',
        name: 'Входящее письмо',
        category: 'letter',
        icon: 'send',
        color: 'info',
      },
      signer: null,
      registrar: null,
      mail: {
        fromAddress: 'info@silium.by',
        fromName: 'ООО «Силиум»',
        messageId: '<abc@silium.by>',
        parseIssue: false,
        storageIncomplete: false,
        bodyPdfIssue: false,
      },
      replySuggestion: null,
      counterpartySuggestion: { counterpartyId: id(), signerId: id() },
      attachments: [
        {
          id: attachmentId,
          fileId: id(),
          role: 'attachment',
          name: 'logo.png',
          mime: 'image/png',
          size: 8_000,
          contentId: 'logo-cid@silium',
          inline: true,
          url: '/api/v1/files/x/content?exp=1&sig=2',
          pdfUrl: null,
          previewKind: 'image',
        },
      ],
      body: { kind: 'document', attachmentId: id() },
      customFields: {},
      customFieldRefs: [],
      attachedRefs: [],
      canManageRelations: false,
      access: { canEdit: false, canDeleteSpam: true, canJoin: true, isParticipant: false },
    });
    expect(detail.mail?.messageId).toBe('<abc@silium.by>');
    expect(detail.replyTo?.regNumber).toBe('Исх-2026/45');
    expect(detail.attachments[0]?.inline).toBe(true);
    // Подтверждение подсказки — ровно одна пара контрагент+подписант.
    expect(detail.counterpartySuggestion?.counterpartyId).toBeTruthy();
  });

  it('история — union по виду; правка несёт 1–20 изменений', () => {
    const base = { id: id(), at: '2026-10-26T08:00:00.000Z', actor: null };
    expect(
      letterHistoryEntrySchema.parse({ ...base, kind: 'registered', regNumber: 'Вх-2026/118' })
        .kind,
    ).toBe('registered');
    expect(
      letterHistoryEntrySchema.safeParse({ ...base, kind: 'updated', changes: [] }).success,
    ).toBe(false);
    expect(
      letterHistoryEntrySchema.parse({
        ...base,
        kind: 'updated',
        changes: [{ field: 'subject', from: 'Старая', to: 'Новая' }],
      }).kind,
    ).toBe('updated');
  });

  it('связь писем в истории: действие, вид и номер второй стороны (#461)', () => {
    const base = { id: id(), at: '2026-10-26T08:00:00.000Z', actor: null };
    const entry = letterHistoryEntrySchema.parse({
      ...base,
      kind: 'relation_changed',
      action: 'linked',
      relationKind: 'nested_in',
      relatedLetter: { id: id(), regNumber: 'Вх-2026/456', subject: null },
    });
    expect(entry.kind).toBe('relation_changed');
    expect(
      letterHistoryEntrySchema.safeParse({ ...base, kind: 'relation_changed', action: 'linked' })
        .success,
    ).toBe(false);
  });

  it('связи: вид и тело создания; дерево — рекурсивный узел с детьми (#461)', () => {
    expect(
      letterRelationCreateBodySchema.parse({ relatedLetterId: id(), kind: 'reply_to' }),
    ).toEqual({ relatedLetterId: expect.any(String), kind: 'reply_to' });
    expect(
      letterRelationCreateBodySchema.safeParse({ relatedLetterId: id(), kind: 'duplicate' })
        .success,
    ).toBe(false);
    expect(
      letterRelationCreateBodySchema.safeParse({
        relatedLetterId: id(),
        kind: 'nested_in',
        replace: true,
      }).success,
    ).toBe(true);

    const tree = letterTreeResponseSchema.parse({
      truncated: true,
      root: {
        id: id(),
        regNumber: 'Вх-2026/1',
        theirNumber: '456',
        subject: 'Конверт',
        direction: 'incoming',
        systemState: 'active',
        confidential: true,
        relationId: null,
        relationKind: null,
        children: [
          {
            id: id(),
            regNumber: null,
            theirNumber: null,
            subject: null,
            direction: 'outgoing',
            systemState: 'done',
            confidential: false,
            relationId: id(),
            relationKind: 'nested_in',
            children: [],
          },
        ],
      },
    });
    expect(tree.root.children).toHaveLength(1);
    expect(tree.root.children[0]?.children).toEqual([]);
  });

  it('правка приложенных писем и флага — через PATCH (#461)', () => {
    const ref = { number: '456', counterpartyId: id(), date: '2026-10-01' };
    expect(updateLetterBodySchema.parse({ attachedRefs: [ref] }).attachedRefs).toEqual([ref]);
    expect(updateLetterBodySchema.parse({ confidential: true }).confidential).toBe(true);
    expect(updateLetterBodySchema.safeParse({ attachedRefs: [] }).success).toBe(true);
  });
});
