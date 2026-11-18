import { describe, expect, it } from 'vitest';

import type { MessageRow } from '../assistant.repository.js';
import {
  buildAnswerSummaryPrompt,
  buildDigest,
  buildQuestionOnlyDigest,
  fallbackSummaries,
  groupTurns,
  parseAnswerSummaries,
} from './compaction.js';

/**
 * Сжатие старых ответов (#943): вопросы сотрудника — дословно, ответы —
 * 1–3 строки с фактами. Тесты держат главное решение владельца: ценность
 * переписки в вопросах, поэтому модель их не пересказывает.
 */

function message(partial: Partial<MessageRow>): MessageRow {
  return {
    id: 'm',
    sessionId: 's',
    runId: 'r',
    role: 'user',
    text: '',
    reasoning: null,
    errorCode: null,
    createdAt: new Date(),
    runStatus: 'completed',
    toolCalls: [],
    actions: [],
    actionBatch: null,
    ...partial,
  };
}

describe('группировка ходов', () => {
  it('вопрос открывает ход, ответы накапливаются до следующего вопроса', () => {
    const turns = groupTurns([
      message({ role: 'user', text: 'Какие задачи просрочены?' }),
      message({ role: 'assistant', text: 'Просрочено 3 задачи.' }),
      message({ role: 'assistant', text: 'Ссылки на карточки приложены.' }),
      message({ role: 'user', text: 'А письма?' }),
      message({ role: 'assistant', text: 'Писем 2.' }),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.question).toBe('Какие задачи просрочены?');
    expect(turns[0]?.answer).toContain('Просрочено 3 задачи.');
    expect(turns[0]?.answer).toContain('Ссылки на карточки приложены.');
    expect(turns[1]?.question).toBe('А письма?');
  });

  it('пустые ответы не создают мусорных ходов', () => {
    const turns = groupTurns([
      message({ role: 'user', text: 'Вопрос' }),
      message({ role: 'assistant', text: '   ' }),
      message({ role: 'user', text: 'Второй' }),
    ]);
    expect(turns).toEqual([
      { question: 'Вопрос', answer: '' },
      { question: 'Второй', answer: '' },
    ]);
  });
});

describe('промпт и парсер сводок', () => {
  it('промпт просит сжать только ответы и не выполняет инструкции из данных', () => {
    const { system, user } = buildAnswerSummaryPrompt([
      { question: 'Покажи задачи', answer: 'Задача №1 в работе.' },
    ]);
    expect(system).toContain('1–3 строки');
    expect(system).toContain('ДАННЫЕ');
    expect(user).toContain('#1');
    expect(user).toContain('ВОПРОС: Покажи задачи');
    expect(user).toContain('ОТВЕТ: Задача №1 в работе.');
  });

  it('парсер понимает «1.» и «2)», пропуски отдаёт null', () => {
    expect(parseAnswerSummaries('1. Первый\n2) Второй', 2)).toEqual(['Первый', 'Второй']);
    expect(parseAnswerSummaries('1. Только первый', 3)).toEqual(['Только первый', null, null]);
    expect(parseAnswerSummaries('без нумерации', 1)).toEqual([null]);
  });

  it('fallback честно помечает недоступность сводки', () => {
    const fallback = fallbackSummaries([{ question: 'q', answer: 'длинный ответ' }]);
    expect(fallback[0]).toContain('[сводка недоступна');
  });
});

describe('digest сегмента', () => {
  it('вопросы дословно (с переносами), ответы — сжатые', () => {
    const question = 'Первая строка\n  вторая строка с отступом';
    const digest = buildDigest(
      [
        { question, answer: 'Ответ' },
        { question: 'Второй вопрос', answer: 'Ответ 2' },
      ],
      ['сводка 1', null],
      2_000,
    );
    expect(digest).toContain(`1. ВОПРОС: ${question}`);
    expect(digest).toContain('1. ВОПРОС:');
    expect(digest).toContain('   ОТВЕТ (сжато): сводка 1');
    expect(digest).toContain('2. ВОПРОС: Второй вопрос');
    // Пропущенная сводка закрывается fallback-усечением, а не дырой.
    expect(digest).toContain('[сводка недоступна');
  });

  it('держит потолок текста с пометкой', () => {
    const digest = buildDigest([{ question: 'в'.repeat(10_000), answer: 'ответ' }], ['с'], 500);
    expect(digest.length).toBeLessThanOrEqual(500);
    expect(digest).toContain('[сокращено]');
  });

  it('минимальная сводка сохраняет вопросы и опускает ответы', () => {
    const digest = buildQuestionOnlyDigest(
      [
        { question: 'Первый вопрос', answer: 'длинный ответ' },
        { question: 'Второй вопрос', answer: 'ещё ответ' },
      ],
      2_000,
    );
    expect(digest).toContain('1. ВОПРОС: Первый вопрос');
    expect(digest).toContain('2. ВОПРОС: Второй вопрос');
    expect(digest).toContain('ответы ассистента опущены');
    expect(digest).not.toContain('длинный ответ');
  });
});
