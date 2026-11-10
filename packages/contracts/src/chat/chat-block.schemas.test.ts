import { describe, expect, it } from 'vitest';

import {
  chatMessageBlockSchema,
  chatMessageKindSchema,
  lookupMessagesQuerySchema,
} from './chat-block.schemas.js';

const block = {
  kind: 'task_transition',
  taskId: crypto.randomUUID(),
  recordId: crypto.randomUUID(),
  transitionName: 'Приостановить',
  fromStageName: 'В работе',
  toStageName: 'Приостановлена',
  commentLabel: 'Причина приостановки',
  result: { fileCount: 2, messageCount: 1 },
};

describe('вид сообщения и блок перехода (#380)', () => {
  it('виды: text и task_transition (#313 добавит system)', () => {
    expect(chatMessageKindSchema.parse('text')).toBe('text');
    expect(chatMessageKindSchema.parse('task_transition')).toBe('task_transition');
    expect(() => chatMessageKindSchema.parse('system')).toThrow();
  });

  it('блок раздела перехода проходит; неизвестный вид отвергается', () => {
    expect(chatMessageBlockSchema.parse(block)).toEqual(block);
    expect(() => chatMessageBlockSchema.parse({ kind: 'system' })).toThrow();
  });

  it('лимиты блока: названия 32/40, подпись 60', () => {
    expect(() =>
      chatMessageBlockSchema.parse({ ...block, transitionName: 'я'.repeat(33) }),
    ).toThrow();
    expect(() =>
      chatMessageBlockSchema.parse({ ...block, fromStageName: 'я'.repeat(41) }),
    ).toThrow();
    expect(() =>
      chatMessageBlockSchema.parse({ ...block, commentLabel: 'я'.repeat(61) }),
    ).toThrow();
  });

  it('блок перехода письма (#55, Р10): цвет цели — ключ палитры, вид — letter_transition', () => {
    const letterBlock = {
      kind: 'letter_transition',
      letterId: crypto.randomUUID(),
      recordId: crypto.randomUUID(),
      transitionName: 'Закрыть без регистрации',
      fromStageName: 'Новое',
      toStageName: 'Не зарегистрировано',
      toStageColor: 'neutral',
      commentLabel: 'Причина',
    };
    expect(chatMessageKindSchema.parse('letter_transition')).toBe('letter_transition');
    expect(chatMessageBlockSchema.parse(letterBlock)).toEqual(letterBlock);
    expect(() =>
      chatMessageBlockSchema.parse({ ...letterBlock, toStageColor: '#ff0000' }),
    ).toThrow();
    expect(() => chatMessageBlockSchema.parse({ ...letterBlock, letterId: undefined })).toThrow();
  });

  it('блок отметки сбора (#434): pressed/returned, лимиты полей', () => {
    const pressBlock = {
      kind: 'task_press',
      taskId: crypto.randomUUID(),
      transitionName: 'Завершить',
      state: 'pressed',
      fileCount: 2,
      returnCount: null,
    };
    expect(chatMessageKindSchema.parse('task_press')).toBe('task_press');
    expect(chatMessageBlockSchema.parse(pressBlock)).toEqual(pressBlock);
    expect(() => chatMessageBlockSchema.parse({ ...pressBlock, state: 'waiting' })).toThrow();
  });

  it('ids lookup: 1..50 уникальных, разбор строки', () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    expect(lookupMessagesQuerySchema.parse({ ids: ids.join(',') }).ids).toEqual(ids);
    expect(() => lookupMessagesQuerySchema.parse({ ids: ids[0] })).not.toThrow();
    expect(() => lookupMessagesQuerySchema.parse({ ids: `${ids[0]},${ids[0]}` })).toThrow();
    expect(() => lookupMessagesQuerySchema.parse({ ids: '' })).toThrow();
    const many = Array.from({ length: 51 }, () => crypto.randomUUID());
    expect(() => lookupMessagesQuerySchema.parse({ ids: many.join(',') })).toThrow();
  });
});
