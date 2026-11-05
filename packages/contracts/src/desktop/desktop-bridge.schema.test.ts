import { describe, expect, it } from 'vitest';

import {
  DESKTOP_BRIDGE_EVENTS,
  openLetterEventSchema,
  popupPayloadSchema,
} from './desktop-bridge.schema.js';

/** Протокол моста оболочки (#618): цель попапа — ровно одна (беседа или
 *  письмо), событие open-letter валидирует letterId. */

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
});

describe('openLetterEventSchema (#618)', () => {
  it('letterId-uuid — валиден, мусор — нет', () => {
    expect(openLetterEventSchema.safeParse({ letterId: LETTER_ID }).success).toBe(true);
    expect(openLetterEventSchema.safeParse({ letterId: 'not-a-uuid' }).success).toBe(false);
    expect(DESKTOP_BRIDGE_EVENTS.openLetter).toBe('open-letter');
  });
});
