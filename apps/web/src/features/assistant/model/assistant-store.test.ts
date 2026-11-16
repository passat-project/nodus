// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_W_DEFAULT,
  ASSISTANT_W_MAX,
  ASSISTANT_W_MIN,
  assistantLiveBounds,
  clampStoredWidth,
  useAssistantStore,
} from './assistant-store.js';

/**
 * Стор окна ассистента (#895): геометрия (клампы ширины) и буфер живого
 * прогона — дельты, строки вызовов, финал. Отмена/ошибка не теряют
 * накопленный текст: сотрудник видит то, что успело прийти.
 */

describe('геометрия окна', () => {
  it('кламп сохранённой ширины: мусор → дефолт, край → в пределы', () => {
    expect(clampStoredWidth(null)).toBe(ASSISTANT_W_DEFAULT);
    expect(clampStoredWidth('мусор')).toBe(ASSISTANT_W_DEFAULT);
    expect(clampStoredWidth('10')).toBe(ASSISTANT_W_DEFAULT);
    expect(clampStoredWidth(String(ASSISTANT_W_MAX + 500))).toBe(ASSISTANT_W_MAX);
    expect(clampStoredWidth(String(ASSISTANT_W_MIN))).toBe(ASSISTANT_W_MIN);
  });

  it('живые пределы не больше 45% рамы', () => {
    const bounds = assistantLiveBounds(1200);
    expect(bounds.max).toBeLessThanOrEqual(Math.floor(1200 * 0.45));
    const narrow = assistantLiveBounds(400);
    expect(narrow.min).toBeLessThanOrEqual(narrow.max);
  });
});

describe('буфер прогона', () => {
  it('дельты текста и размышлений копятся раздельно', () => {
    const store = useAssistantStore.getState();
    store.startLive({ runId: 'run-1', sessionId: 's-1' });
    store.appendDelta('reasoning', 'думаю');
    store.appendDelta('text', 'Привет');
    store.appendDelta('text', ', мир');
    const live = useAssistantStore.getState().live;
    expect(live?.text).toBe('Привет, мир');
    expect(live?.reasoning).toBe('думаю');
  });

  it('строки вызовов обновляются по id, а не дублируются', () => {
    const store = useAssistantStore.getState();
    store.startLive({ runId: 'run-2', sessionId: 's-1' });
    store.upsertTool({
      id: 'call-1',
      toolId: 'tasks.list',
      title: 'Задачи: список',
      status: 'running',
      args: null,
      resultPreview: null,
      durationMs: null,
      errorCode: null,
      href: null,
      hrefLabel: null,
    });
    store.upsertTool({
      id: 'call-1',
      toolId: 'tasks.list',
      title: 'Задачи: список',
      status: 'done',
      args: null,
      resultPreview: '12 задач',
      durationMs: 20,
      errorCode: null,
      href: '?cards=task:1',
      hrefLabel: '№1 Тест',
    });
    const tools = useAssistantStore.getState().live?.tools ?? [];
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ status: 'done', href: '?cards=task:1' });
  });

  it('отмена сохраняет текст и закрывает приём дельт', () => {
    const store = useAssistantStore.getState();
    store.startLive({ runId: 'run-3', sessionId: 's-2' });
    store.appendDelta('text', 'Начал отвечать');
    store.finishLive('cancelled');
    store.appendDelta('text', ' — это уже не должно попасть');
    const live = useAssistantStore.getState().live;
    expect(live?.status).toBe('cancelled');
    expect(live?.text).toBe('Начал отвечать');
  });

  it('ошибка несёт код и сообщение для перевода в человеческий текст', () => {
    const store = useAssistantStore.getState();
    store.startLive({ runId: 'run-4', sessionId: 's-3' });
    store.finishLive('error', { code: 'provider_rate_limited', message: 'wait' });
    expect(useAssistantStore.getState().live).toMatchObject({
      status: 'error',
      errorCode: 'provider_rate_limited',
      errorMessage: 'wait',
    });
  });
});
