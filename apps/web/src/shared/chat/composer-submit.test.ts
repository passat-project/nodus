import { describe, expect, it } from 'vitest';

import type { PendingAttachment } from './chat-drafts.js';
import type { StickerSubmitPayload } from './sticker-api.js';
import { toSendVars } from './composer-submit.js';

/** ComposerSubmit → SendChatVars (#143): стикер — приоритетная ветка
 *  (отдельное сообщение без текста, черновик не съедается); обычный путь
 *  (текст/вложения/цитата) не меняется. */

const STICKER: StickerSubmitPayload = {
  stickerId: '11111111-1111-4111-8111-111111111111',
  attachment: {
    id: '22222222-2222-4222-8222-222222222222',
    fileId: '11111111-1111-4111-8111-111111111111',
    name: 'sticker.png',
    size: 1000,
    mime: 'image/png',
    kind: 'sticker',
    url: '/stickers/demo/1.png',
    thumbnailUrl: null,
    previewKind: 'image',
    pdfUrl: null,
    width: 512,
    height: 512,
    sticker: {
      packId: '33333333-3333-4333-8333-333333333333',
      packTitle: 'Nodus',
      packScope: 'corporate',
      emojis: ['🔥'],
    },
  },
};

describe('toSendVars: стикер-ветка (#143)', () => {
  it('стикер → stickerId + превью-вложение, текст пуст, keepDraft', () => {
    const vars = toSendVars({
      text: 'набранный текст остаётся в композере',
      attachments: [],
      reply: null,
      edit: null,
      sticker: STICKER,
    });
    expect(vars).toMatchObject({
      text: '',
      stickerId: STICKER.stickerId,
      keepDraft: true,
      replyToId: null,
    });
    expect(vars.attachments).toEqual([STICKER.attachment]);
    expect(vars.attachmentIds).toBeUndefined();
  });

  it('без стикера — прежний путь (текст/вложения/цитата)', () => {
    const vars = toSendVars({ text: 'привет', attachments: [], reply: null, edit: null });
    expect(vars.text).toBe('привет');
    expect(vars.stickerId).toBeUndefined();
    expect(vars.keepDraft).toBeUndefined();
  });

  it('ответ-стикером (#288): активный ответ уходит в vars — ветка НЕ обнуляет цитату', () => {
    // Регресс 14.10: стикерная ветка хардкодила replyToId/reply null —
    // клик по стикеру в режиме ответа отправлял обычным сообщением.
    const reply = {
      messageId: '44444444-4444-4444-8444-444444444444',
      author: { id: 'u9', displayName: 'Мария Соколова', avatarUrl: null },
      snippet: 'оригинал',
      quoteText: 'фрагмент',
      attachmentKind: null,
      stickerUrl: null,
      stickerEmoji: null,
      stickerMime: null,
      inThread: null,
    };
    const vars = toSendVars({
      text: '',
      attachments: [],
      reply,
      edit: null,
      sticker: STICKER,
    });
    expect(vars.replyToId).toBe(reply.messageId);
    expect(vars.quoteText).toBe('фрагмент');
    expect(vars.reply).toMatchObject({ id: reply.messageId, quoteText: 'фрагмент' });
    expect(vars.keepDraft).toBe(true);
  });
});

describe('toSendVars: переименования окна отправки (#146)', () => {
  const attachment = {
    id: '55555555-5555-4555-8555-555555555555',
    fileId: '66666666-6666-4666-8666-666666666666',
    name: 'scan.pdf',
    size: 10,
    mime: 'application/pdf',
    kind: 'file' as const,
    url: null,
    thumbnailUrl: null,
    previewKind: 'file' as const,
    pdfUrl: null,
    width: null,
    height: null,
  };
  const ready = (fileName: string): PendingAttachment => ({
    localId: 'local-1',
    fileName,
    mime: 'application/pdf',
    size: 10,
    progress: 1,
    status: 'ready',
    attachment,
    objectUrl: null,
  });

  it('имя окна ≠ серверного → attachmentRenames + имя в превью темп-сообщения', () => {
    const vars = toSendVars({
      text: '',
      attachments: [ready('  Смета на согласование.pdf  ')],
      reply: null,
      edit: null,
    });
    expect(vars.attachmentIds).toEqual([attachment.id]);
    expect(vars.attachmentRenames).toEqual([
      { id: attachment.id, name: 'Смета на согласование.pdf' },
    ]);
    // Пузырь показывает имя окна, а восстановление упавшей отправки получает
    // СЕРВЕРНОЕ имя + renames отдельно (кейс code-review #146).
    expect(vars.optimisticAttachments?.[0]?.name).toBe('Смета на согласование.pdf');
    expect(vars.attachments?.[0]?.name).toBe('scan.pdf');
  });

  it('имя не менялось — renames не уходят (лишний UPDATE на сервере не нужен)', () => {
    const vars = toSendVars({
      text: '',
      attachments: [ready('scan.pdf')],
      reply: null,
      edit: null,
    });
    expect(vars.attachmentRenames).toBeUndefined();
  });
});

describe('toSendVars: молния «Важное» (#177, ревизия 05.10 — тоггл)', () => {
  it('urgent летит в vars обычной отправки', () => {
    const vars = toSendVars({
      text: 'Завтра объект закрыт',
      attachments: [],
      reply: null,
      edit: null,
      urgent: true,
    });
    expect(vars.urgent).toBe(true);
  });

  it('без молнии — явный false (не undefined)', () => {
    const vars = toSendVars({ text: 'обычное', attachments: [], reply: null, edit: null });
    expect(vars.urgent).toBe(false);
  });

  it('стикер отправляется обычным, даже если молния горит', () => {
    const vars = toSendVars({
      text: '',
      attachments: [],
      reply: null,
      edit: null,
      sticker: STICKER,
      urgent: true,
    });
    expect(vars.urgent).toBeUndefined();
  });
});
