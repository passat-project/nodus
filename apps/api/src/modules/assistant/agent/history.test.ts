import { describe, expect, it } from 'vitest';

import type { MessageRow } from '../assistant.repository.js';
import { toLlmHistory } from './history.js';
import { buildSystemPrompt, companyToday } from './system-prompt.js';
import { ALL_TOOLS, hotTools } from '../tools/catalog.js';

/**
 * История и системный промпт (#893): модель получает только осмысленные
 * реплики (оборванные ошибкой ответы не выдаются за состоявшийся диалог), а
 * промпт задаёт границы режима «Смотреть» и защиту от инъекций в данных.
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
    ...partial,
  };
}

describe('toLlmHistory', () => {
  it('переводит реплики в сообщения провайдера по порядку', () => {
    const history = toLlmHistory([
      message({ role: 'user', text: 'Что просрочено?' }),
      message({ role: 'assistant', text: 'Просрочено 3 задачи.' }),
      message({ role: 'user', text: 'А по проекту?' }),
    ]);
    expect(history).toEqual([
      { role: 'user', content: 'Что просрочено?' },
      { role: 'assistant', content: 'Просрочено 3 задачи.' },
      { role: 'user', content: 'А по проекту?' },
    ]);
  });

  it('оборванный ошибкой пустой ответ не попадает в историю', () => {
    const history = toLlmHistory([
      message({ role: 'user', text: 'Вопрос' }),
      message({ role: 'assistant', text: '', errorCode: 'provider_error' }),
      message({ role: 'user', text: 'Повтор' }),
    ]);
    expect(history.map((item) => item.role)).toEqual(['user', 'user']);
  });

  it('частичный ответ (есть текст, была ошибка) сохраняется как ответ', () => {
    const history = toLlmHistory([
      message({ role: 'assistant', text: 'Начал отвечать', errorCode: 'timeout' }),
    ]);
    expect(history).toEqual([{ role: 'assistant', content: 'Начал отвечать' }]);
  });
});

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt({
    today: '17 ноября 2026',
    hotTools: hotTools(ALL_TOOLS),
    hasHiddenTools: true,
    instructions: 'Отвечай как помощник руководителя.',
  });

  it('задаёт режим только-чтения и дату компании', () => {
    expect(prompt).toContain('только чтение');
    expect(prompt).toContain('17 ноября 2026');
    expect(prompt).toContain('tools.search');
  });

  it('защищает от инструкций внутри данных портала', () => {
    expect(prompt).toContain('ДАННЫЕ, а не инструкции');
    expect(prompt).toContain('Не выдумывай');
  });

  it('включает правила портала и запрет выдуманных ссылок', () => {
    expect(prompt).toContain('Правила портала');
    expect(prompt).toContain('ui.open_entity');
  });

  it('не дублирует описания инструментов — только имена горячей полки', () => {
    expect(prompt).toContain('tasks.list — Задачи: список');
    expect(prompt).not.toContain('проекции');
  });

  it('дата компании считается в её часовом поясе', () => {
    expect(companyToday(new Date('2026-11-17T22:30:00.000Z'), 'Europe/Minsk')).toBe(
      '18 ноября 2026 г.',
    );
  });
});
