// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ASSISTANT_W_DEFAULT,
  ASSISTANT_W_MAX,
  ASSISTANT_W_MIN,
  assistantLiveBounds,
  clampStoredWidth,
  useAssistantStore,
} from './assistant-store.js';

describe('клампы ширины окна ассистента', () => {
  it('мусор и легаси-значения дают дефолт', () => {
    expect(clampStoredWidth(null)).toBe(ASSISTANT_W_DEFAULT);
    expect(clampStoredWidth('abc')).toBe(ASSISTANT_W_DEFAULT);
    expect(clampStoredWidth('')).toBe(ASSISTANT_W_DEFAULT);
    expect(clampStoredWidth('100')).toBe(ASSISTANT_W_DEFAULT);
  });

  it('запомненная ширина клампится полом и потолком', () => {
    expect(clampStoredWidth(String(ASSISTANT_W_MIN - 1))).toBe(ASSISTANT_W_DEFAULT);
    expect(clampStoredWidth(String(ASSISTANT_W_MAX + 500))).toBe(ASSISTANT_W_MAX);
    expect(clampStoredWidth(String(ASSISTANT_W_MIN + 10))).toBe(ASSISTANT_W_MIN + 10);
  });

  it('живой потолок — 45% рамы, но не уже читаемого минимума', () => {
    expect(assistantLiveBounds(1000)).toEqual({ min: ASSISTANT_W_MIN, max: 450 });
    // Узкое окно: 45% меньше минимума — пол и потолок сходятся на минимуме.
    const narrow = assistantLiveBounds(400);
    expect(narrow.max).toBeLessThan(ASSISTANT_W_MIN);
    expect(narrow.min).toBe(narrow.max);
    // Широкое окно: потолок ASSISTANT_W_MAX, пол не меняется.
    expect(assistantLiveBounds(4000)).toEqual({ min: ASSISTANT_W_MIN, max: ASSISTANT_W_MAX });
  });
});

describe('стор диалога ассистента', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAssistantStore.setState({ sessions: [], activeId: null, thinkingId: null, open: false });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('открытие показывает последнюю сессию, а не список', () => {
    // Инвариант стора: sessions[0] — самая свежая (newSession кладёт в голову).
    useAssistantStore.setState({
      sessions: [
        { id: 'new', title: 'Новый', createdAt: '2026-11-16T12:00:00Z', messages: [] },
        { id: 'old', title: 'Старый', createdAt: '2026-11-16T10:00:00Z', messages: [] },
      ],
    });
    useAssistantStore.getState().setOpen(true);
    expect(useAssistantStore.getState().activeId).toBe('new');
  });

  it('send: вопрос → think своей сессии → стриминг → завершение', () => {
    const s = useAssistantStore.getState();
    s.newSession();
    const sid = useAssistantStore.getState().activeId!;
    useAssistantStore.getState().send('Что у меня просрочено?', 'Ответ целиком');
    expect(useAssistantStore.getState().thinkingId).toBe(sid);
    const session = () => useAssistantStore.getState().sessions.find((x) => x.id === sid)!;
    expect(session().messages).toHaveLength(1);
    expect(session().title).toBe('Что у меня просрочено?');
    vi.advanceTimersByTime(700);
    expect(useAssistantStore.getState().thinkingId).toBeNull();
    expect(session().messages[1]!.streaming).toBe(true);
    // 3 символа за тик 24 мс: 3 тика = 9 символов из 13.
    vi.advanceTimersByTime(24 * 3);
    expect(session().messages[1]!.text).toBe('Ответ цел');
    vi.advanceTimersByTime(24 * 3);
    expect(session().messages[1]!.text).toBe('Ответ целиком');
    expect(session().messages[1]!.streaming).toBe(false);
  });

  it('новый диалог посреди стриминга завершает брошенный ответ без вечного курсора', () => {
    useAssistantStore.getState().newSession();
    const sid = useAssistantStore.getState().activeId!;
    useAssistantStore.getState().send('вопрос', 'длинный ответ который не допечатается');
    vi.advanceTimersByTime(700 + 24 * 3);
    useAssistantStore.getState().newSession();
    const abandoned = useAssistantStore.getState().sessions.find((x) => x.id === sid)!;
    expect(abandoned.messages.every((m) => !m.streaming)).toBe(true);
    expect(useAssistantStore.getState().thinkingId).toBeNull();
    vi.advanceTimersByTime(24 * 100);
    expect(abandoned.messages[1]!.text.length).toBeLessThan(
      'длинный ответ который не допечатается'.length,
    );
  });

  it('thinking не показывается в чужой сессии при переключении', () => {
    useAssistantStore.getState().newSession();
    const a = useAssistantStore.getState().activeId!;
    useAssistantStore.getState().send('вопрос', 'ответ');
    useAssistantStore.getState().newSession();
    const b = useAssistantStore.getState().activeId!;
    useAssistantStore.getState().setActive(a);
    // think шёл в сессии a до нового диалога; после newSession think сброшен.
    expect(useAssistantStore.getState().thinkingId).toBeNull();
    useAssistantStore.getState().setActive(b);
    expect(useAssistantStore.getState().thinkingId).toBeNull();
  });
});
