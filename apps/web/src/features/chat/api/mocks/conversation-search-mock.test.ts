import { describe, expect, it } from 'vitest';

import { demoConversations } from '../../../../shared/mocks/data/chat.js';
import { matchesConversationSearch } from './conversation-search-mock.js';

/**
 * #956: мок `GET /chat/conversations?search=` обязан повторять сервер —
 * название, участники, название/номер задачи, тема/номер письма. Иначе
 * дневной контур :5173 перестаёт фильтровать список после перевода фронта
 * на серверный поиск (паритет моков, patterns.md).
 */
describe('мок поиска бесед (#956)', () => {
  const taskChat = demoConversations.find((c) => c.type === 'task' && c.task);
  const letterChat = demoConversations.find((c) => c.type === 'letter' && c.letter);

  it('находит чат задачи по названию, номеру и префиксу ПП', () => {
    expect(taskChat?.task).toBeDefined();
    const task = taskChat!.task!;
    expect(matchesConversationSearch(taskChat!, task.title.slice(0, 12))).toBe(true);
    expect(matchesConversationSearch(taskChat!, String(task.number))).toBe(true);
    expect(matchesConversationSearch(taskChat!, `ПП-${task.number}`)).toBe(true);
  });

  it('находит чат письма по теме и регистрационному номеру', () => {
    const letter = letterChat!.letter!;
    expect(letter.subject).not.toBeNull();
    if (!letter.subject) return;
    expect(matchesConversationSearch(letterChat!, letter.subject.slice(0, 10))).toBe(true);
    if (letter.regNumber) {
      expect(matchesConversationSearch(letterChat!, letter.regNumber)).toBe(true);
    }
  });

  it('находит по имени участника и регистронезависимо', () => {
    const member = taskChat!.membersPreview[0]!;
    expect(matchesConversationSearch(taskChat!, member.displayName.toUpperCase())).toBe(true);
  });

  it('пустой запрос пропускает всё, несовпадение — нет', () => {
    expect(matchesConversationSearch(taskChat!, '   ')).toBe(true);
    expect(matchesConversationSearch(taskChat!, 'нет-такого-слова-42')).toBe(false);
  });
});
