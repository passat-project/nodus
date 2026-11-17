// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { resetSessionState } from '../../../shared/session-reset.js';
import { useAssistantStore } from '../model/assistant-store.js';
// Импорт модуля регистрирует обработчик сброса сессии (побочный эффект модуля).
import './assistant-api.js';

/**
 * AUD-005: выход или вход другим сотрудником в той же вкладке стирает диалог
 * ассистента из памяти вкладки — иначе следующий вошедший увидел бы чужой
 * вопрос/ответ и живой поток продолжил бы дописывать дельты от чужого имени
 * (находка security-ревью 17.11.2026).
 */
describe('ассистент и сброс сессии', () => {
  it('resetSessionState гасит окно, диалог, вопрос до сессии и живой прогон', () => {
    useAssistantStore.setState({
      open: true,
      activeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      pending: { text: 'чужой вопрос', at: Date.now() },
      live: {
        runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        messageId: null,
        userText: 'чужой вопрос',
        userMessageId: null,
        startedAt: Date.now(),
        text: 'чужой ответ',
        reasoning: '',
        tools: [],
        status: 'running',
        errorCode: null,
        errorMessage: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
      },
    });

    resetSessionState('user-1');

    const state = useAssistantStore.getState();
    expect(state.open).toBe(false);
    expect(state.activeId).toBeNull();
    expect(state.pending).toBeNull();
    expect(state.live).toBeNull();
  });
});
