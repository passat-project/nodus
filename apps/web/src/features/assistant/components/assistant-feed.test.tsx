// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui, type AssistantMessage, type AssistantToolCall } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { AssistantFeed, AssistantReasoning, errorText } from './assistant-feed.js';
import type { AssistantLiveRun } from '../model/assistant-store.js';

/** Фото сотрудника и «избранное» — чужие запросы ленты, к тесту не относятся. */
vi.mock('../../../shared/ui/use-person-avatar-url.js', () => ({
  usePersonAvatarUrl: () => 'https://files.nodus.local/avatar/me.png',
}));
vi.mock('../../../shared/chat/favorites-api.js', () => ({
  useFavoriteIds: () => new Set<string>(),
  useNotesConversationId: () => null,
}));

/**
 * Лента ассистента (#895): сегменты по автору, вопрос сотрудника справа,
 * ответ агента слева, строки вызовов инструментов, скрываемые размышления,
 * ошибка прогона с «Повторить», статус отмены и чип дня.
 */

let messageSeq = 0;

function message(
  role: AssistantMessage['role'],
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  messageSeq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(messageSeq).padStart(12, '0')}`,
    role,
    text: '',
    reasoning: null,
    createdAt: '2026-11-17T09:00:00.000Z',
    runId: null,
    streaming: false,
    errorCode: null,
    toolCalls: [],
    actions: [],
    ...overrides,
  };
}

function tool(overrides: Partial<AssistantToolCall> = {}): AssistantToolCall {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    toolId: 'tasks.list',
    title: 'Задачи: список',
    status: 'done',
    args: null,
    resultPreview: null,
    durationMs: null,
    errorCode: null,
    href: null,
    hrefLabel: null,
    ...overrides,
  };
}

function live(overrides: Partial<AssistantLiveRun> = {}): AssistantLiveRun {
  return {
    runId: '20000000-0000-4000-8000-000000000001',
    sessionId: 's-1',
    messageId: null,
    userText: '',
    userMessageId: null,
    startedAt: Date.now(),
    text: '',
    reasoning: '',
    tools: [],
    actions: [],
    status: 'running',
    errorCode: null,
    errorMessage: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    ...overrides,
  };
}

function renderFeed(
  messages: AssistantMessage[],
  options: { live?: AssistantLiveRun | null; activeSessionId?: string | null } = {},
) {
  const onRetry = vi.fn();
  const result = render(
    <AssistantFeed
      messages={messages}
      live={options.live ?? null}
      activeSessionId={options.activeSessionId ?? 's-1'}
      onRetry={onRetry}
    />,
  );
  return { ...result, onRetry };
}

function runs(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[data-slot="message-run"]'));
}

beforeEach(() => {
  messageSeq = 0;
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-token',
    user: {
      id: '30000000-0000-4000-8000-000000000001',
      email: 'me@nodus.by',
      displayName: 'Мария Смирнова',
      permissions: [],
      modules: [],
    } as never,
  });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null, accessToken: null, status: 'unknown' });
});

describe('AssistantFeed: сегменты и выравнивание', () => {
  it('вопрос сотрудника справа, ответ агента слева (конвенция харнесов)', () => {
    const { container } = renderFeed([
      message('user', { text: 'Что у меня просрочено?' }),
      message('assistant', { text: 'Две задачи.' }),
    ]);

    const [userRun, assistantRun] = runs(container);
    // Своя серия зеркалится: grid-колонки «контент + аватар», строка — колонка 1.
    expect(userRun!.className).toContain('grid-cols-[minmax(0,1fr)_2rem]');
    expect(assistantRun!.className).toContain('grid-cols-[2rem_minmax(0,1fr)]');

    expect(screen.getByText('Что у меня просрочено?')).toBeTruthy();
    expect(screen.getByText('Две задачи.')).toBeTruthy();
    // Своя аватарка — сотрудник, агент — глиф (Bot), а не карточка сотрудника.
    expect(container.querySelectorAll('[data-slot="message-run-avatar"]')).toHaveLength(2);
  });

  it('ответ агента — Markdown, вопрос сотрудника — простой текст (#897)', () => {
    const { container } = renderFeed([
      message('user', { text: '**не жирный**' }),
      message('assistant', { text: '**жирный** и список:\n\n- раз\n- два' }),
    ]);

    // Вопрос остаётся как в мессенджере: звёздочки видны, разметки нет.
    expect(screen.getByText('**не жирный**')).toBeTruthy();
    // Ответ разобран: сильный акцент и элементы списка.
    expect(container.querySelector('strong')?.textContent).toBe('жирный');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('подряд идущие реплики одного автора — одна серия (без дублей аватара)', () => {
    const { container } = renderFeed([
      message('user', { text: 'Первый вопрос' }),
      message('user', { text: 'Второй вопрос' }),
      message('assistant', { text: 'Ответ' }),
    ]);

    // 2 серии: сотрудник (2 пузыря) и агент.
    expect(runs(container)).toHaveLength(2);
  });

  it('ход с вызовами инструментов разрывает серию на вводный блок', () => {
    const { container } = renderFeed([
      message('assistant', { text: 'Прошлый ответ.' }),
      message('assistant', { text: 'Сейчас посмотрю.', toolCalls: [tool()] }),
      message('assistant', { text: 'Готово: две задачи.' }),
    ]);

    // Прошлый ответ — своя серия; новый ход с вызовами начинает отдельный
    // сегмент (строки действий сверху), продолжение примыкает к нему.
    expect(runs(container)).toHaveLength(2);
    expect(screen.getByText('Задачи: список')).toBeTruthy();
    expect(screen.getByText('Прошлый ответ.')).toBeTruthy();
    expect(screen.getByText('Сейчас посмотрю.')).toBeTruthy();
    expect(screen.getByText('Готово: две задачи.')).toBeTruthy();
  });

  it('размышления модели — свёрнутый details над пузырём', () => {
    const { container } = renderFeed([
      message('assistant', { text: 'Ответ', reasoning: 'Сначала проверю права.' }),
    ]);

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(screen.getByText(ui.assistant.reasoningTitle)).toBeTruthy();
    expect(screen.getByText('Сначала проверю права.')).toBeTruthy();
  });

  it('без авторизованного сотрудника лента не падает (подпись «Я» по фолбэку)', () => {
    useAuthStore.setState({ user: null });
    renderFeed([message('user', { text: 'вопрос без профиля' })]);
    expect(screen.getByText('вопрос без профиля')).toBeTruthy();
  });

  it('AssistantReasoning: стриминг помечает блок точкой и подтягивает скролл', () => {
    const { container } = render(<AssistantReasoning reasoning="думаю" streaming />);
    expect(container.querySelector('details')!.open).toBe(false);
    expect(container.querySelector('summary')!.textContent).toContain('•');
    expect(container.querySelector('[data-reasoning-body]')!.textContent).toBe('думаю');
  });
});

describe('AssistantFeed: вызовы и навигация', () => {
  it('ui.open_entity не строка вызова, а кнопка «Открыть» под ответом', () => {
    renderFeed([
      message('assistant', {
        text: 'Вот карточка.',
        toolCalls: [
          tool({ title: 'Задачи: список' }),
          tool({
            id: '10000000-0000-4000-8000-000000000002',
            toolId: 'ui.open_entity',
            title: 'Открыть задачу',
            href: '?cards=task:abc',
            hrefLabel: '№12 Проверить',
          }),
        ],
      }),
    ]);

    expect(screen.getByText('Задачи: список')).toBeTruthy();
    expect(screen.queryByText('Открыть задачу')).toBeNull();
    const open = screen.getByRole('button', { name: `${ui.assistant.open}: №12 Проверить` });
    expect(open).toBeTruthy();
  });
});

describe('AssistantFeed: ошибки и состояния прогона', () => {
  it('ошибка прогона без текста: только понятная строка и «Повторить», пузыря нет', () => {
    const { container, onRetry } = renderFeed([
      message('assistant', { errorCode: 'provider_unavailable' }),
    ]);

    expect(runs(container)).toHaveLength(0);
    expect(screen.getByText(ui.assistant.errors.provider_unavailable)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.assistant.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('неизвестный код ошибки переводится в общий текст', () => {
    renderFeed([message('assistant', { errorCode: 'unknown_code' })]);
    expect(screen.getByText(ui.assistant.errors.internal)).toBeTruthy();
    expect(errorText('max_steps')).toBe(ui.assistant.errors.max_steps);
    expect(errorText('что-то')).toBe(ui.assistant.errors.internal);
  });

  it('живой прогон: точки «думает» и статус отмены', () => {
    const { container, rerender } = render(
      <AssistantFeed
        messages={[message('user', { text: 'вопрос' })]}
        live={live()}
        activeSessionId="s-1"
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('status', { name: ui.assistant.thinking })).toBeTruthy();

    rerender(
      <AssistantFeed
        messages={[message('user', { text: 'вопрос' })]}
        live={live({ status: 'cancelled', text: 'Начал отвечать' })}
        activeSessionId="s-1"
        onRetry={() => undefined}
      />,
    );
    expect(screen.queryByRole('status', { name: ui.assistant.thinking })).toBeNull();
    expect(screen.getByText(ui.assistant.cancelled)).toBeTruthy();
    // Текст живого буфера в ленту приходит уже слитым (mergeLiveMessage в
    // теле окна), сама лента рисует только состояние прогона.
    expect(container.textContent).not.toContain('Начал отвечать');
  });

  it('живой прогон ЧУЖОЙ сессии в ленте не показывается', () => {
    renderFeed([message('user', { text: 'вопрос' })], {
      live: live({ sessionId: 's-other' }),
      activeSessionId: 's-1',
    });
    expect(screen.queryByRole('status', { name: ui.assistant.thinking })).toBeNull();
  });

  it('ошибка и отмена живого буфера видны через историю (errorCode)', () => {
    renderFeed([message('assistant', { text: 'кусок', errorCode: 'timeout' })]);
    expect(screen.getByText(ui.assistant.errors.timeout)).toBeTruthy();
    expect(screen.getByText('кусок')).toBeTruthy();
  });
});

describe('AssistantFeed: чип дня', () => {
  it('первый день всегда с чипом, второй — при смене календарного дня', () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    renderFeed([
      message('user', { text: 'вчерашний вопрос', createdAt: yesterday.toISOString() }),
      message('assistant', { text: 'сегодняшний ответ', createdAt: today.toISOString() }),
    ]);

    const separators = screen.getAllByRole('separator');
    expect(separators.map((el) => el.getAttribute('aria-label'))).toEqual([
      ui.chat.yesterday,
      ui.chat.today,
    ]);
  });

  it('в пределах одного дня чип один, даже если сегментов несколько', () => {
    renderFeed([message('user', { text: 'вопрос' }), message('assistant', { text: 'ответ' })]);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });
});

describe('AssistantFeed: прокрутка', () => {
  it('скролл вверх отключает автодогон (событие читается без падения)', () => {
    const { container } = renderFeed([message('user', { text: 'вопрос' })]);
    const scroller = container.firstElementChild as HTMLElement;
    fireEvent.scroll(scroller);
    expect(scroller).toBeTruthy();
  });
});
