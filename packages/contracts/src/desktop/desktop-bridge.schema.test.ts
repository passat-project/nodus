import { describe, expect, it } from 'vitest';

import {
  DESKTOP_BRIDGE_EVENTS,
  openLetterEventSchema,
  popupDiagnosticSchema,
  popupPayloadSchema,
  shellFocusEventSchema,
} from './desktop-bridge.schema.js';

/** Протокол моста оболочки (#618, #647): цель попапа — ровно одна (беседа,
 *  письмо или скачанный файл), событие open-letter валидирует letterId. */

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const LETTER_ID = '22222222-2222-4222-8222-222222222222';

const base = {
  id: 'n1',
  title: 'Автор',
  preview: 'текст',
  urgent: false,
  canReply: true,
};

describe('popupPayloadSchema (#618)', () => {
  it('беседа без письма — валидна (обратная совместимость чата)', () => {
    const parsed = popupPayloadSchema.safeParse({ ...base, conversationId: CONVERSATION_ID });
    expect(parsed.success).toBe(true);
  });

  it('письмо без беседы — валидно (Поступило письмо)', () => {
    const parsed = popupPayloadSchema.safeParse({
      ...base,
      letterId: LETTER_ID,
      canReply: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('обе цели или ни одной — невалидны (ровно одна)', () => {
    expect(
      popupPayloadSchema.safeParse({
        ...base,
        conversationId: CONVERSATION_ID,
        letterId: LETTER_ID,
      }).success,
    ).toBe(false);
    expect(popupPayloadSchema.safeParse(base).success).toBe(false);
  });

  it('скачанный файл — третья цель, без беседы и письма (#647)', () => {
    expect(
      popupPayloadSchema.safeParse({
        ...base,
        canReply: false,
        download: { fileName: 'Смета.xlsx', success: true },
      }).success,
    ).toBe(true);
    // Ошибка скачивания — та же цель, карточка без кнопки.
    expect(
      popupPayloadSchema.safeParse({
        ...base,
        canReply: false,
        download: { fileName: 'Смета.xlsx', success: false },
      }).success,
    ).toBe(true);
  });

  it('скачивание вместе с беседой/письмом — невалидно (ровно одна цель)', () => {
    const download = { fileName: 'Смета.xlsx', success: true };
    expect(
      popupPayloadSchema.safeParse({
        ...base,
        conversationId: CONVERSATION_ID,
        download,
      }).success,
    ).toBe(false);
    expect(
      popupPayloadSchema.safeParse({
        ...base,
        letterId: LETTER_ID,
        download,
      }).success,
    ).toBe(false);
  });

  it('скачивание требует непустого имени файла', () => {
    for (const fileName of ['', '   ', 'x'.repeat(256)]) {
      expect(
        popupPayloadSchema.safeParse({
          ...base,
          canReply: false,
          download: { fileName, success: true },
        }).success,
      ).toBe(false);
    }
  });
});

describe('openLetterEventSchema (#618)', () => {
  it('letterId-uuid — валиден, мусор — нет', () => {
    expect(openLetterEventSchema.safeParse({ letterId: LETTER_ID }).success).toBe(true);
    expect(openLetterEventSchema.safeParse({ letterId: 'not-a-uuid' }).success).toBe(false);
    expect(DESKTOP_BRIDGE_EVENTS.openLetter).toBe('open-letter');
  });
});

describe('shellFocusEventSchema (#770)', () => {
  it('фокус/свёрнутость — строгий boolean, событие в каталоге', () => {
    expect(shellFocusEventSchema.safeParse({ focused: true }).success).toBe(true);
    expect(shellFocusEventSchema.safeParse({ focused: false }).success).toBe(true);
    expect(shellFocusEventSchema.safeParse({ focused: 'да' }).success).toBe(false);
    expect(shellFocusEventSchema.safeParse({}).success).toBe(false);
    expect(DESKTOP_BRIDGE_EVENTS.shellFocus).toBe('shell-focus');
  });
});

describe('popupDiagnosticSchema (#811)', () => {
  it('id/код причины — валидно; неизвестная причина и чужие типы — нет', () => {
    expect(
      popupDiagnosticSchema.safeParse({
        messageId: 'm1',
        conversationId: CONVERSATION_ID,
        reason: 'looking',
      }).success,
    ).toBe(true);
    expect(
      popupDiagnosticSchema.safeParse({
        messageId: null,
        conversationId: null,
        reason: 'rejected',
        detail: 'title_empty',
      }).success,
    ).toBe(true);
    expect(
      popupDiagnosticSchema.safeParse({
        messageId: null,
        conversationId: null,
        reason: 'unknown\n',
      }).success,
    ).toBe(false);
    expect(
      popupDiagnosticSchema.safeParse({ messageId: 42, conversationId: null, reason: 'sent' })
        .success,
    ).toBe(false);
  });
});
