// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ui, type AssistantMessage, type AssistantSession } from '@nodus/contracts';

const h = vi.hoisted(() => ({
  sessions: vi.fn(),
  messages: vi.fn(),
  create: vi.fn(),
  send: vi.fn(),
  cancel: vi.fn(),
  isRunActive: vi.fn(),
  isStreamActive: vi.fn(),
  stopStream: vi.fn(),
  recover: vi.fn(),
  merge: vi.fn(),
  context: vi.fn(),
  createAsync: vi.fn(),
  sendMutate: vi.fn(),
  cancelAsync: vi.fn(),
  feedProps: { current: null as Record<string, unknown> | null },
  composerProps: { current: null as Record<string, unknown> | null },
}));

vi.mock('../api/assistant-api.js', () => ({
  useAssistantSessions: h.sessions,
  useAssistantMessages: h.messages,
  useCreateAssistantSession: h.create,
  useSendAssistantMessage: h.send,
  useCancelAssistantRun: h.cancel,
  useIsRunActive: h.isRunActive,
  isRunStreamActive: h.isStreamActive,
  mergeLiveMessage: h.merge,
  recoverAssistantRun: h.recover,
  stopRunStream: h.stopStream,
}));

vi.mock('../model/use-assistant-context.js', () => ({
  useAssistantContext: h.context,
}));

vi.mock('./assistant-feed.js', () => ({
  AssistantGlyph: () => <span data-testid="assistant-glyph" />,
  AssistantFeed: (props: Record<string, unknown>) => {
    h.feedProps.current = props;
    return <div data-testid="assistant-feed" />;
  },
}));

vi.mock('./assistant-memory-picker.js', () => ({
  AssistantMemoryPicker: () => <button type="button">блокнот</button>,
}));

vi.mock('./assistant-session-picker.js', () => ({
  AssistantSessionPicker: () => <button type="button">выбрать диалог</button>,
}));

vi.mock('./assistant-welcome.js', () => ({
  AssistantWelcome: ({ hasCard, onPick }: { hasCard: boolean; onPick: (text: string) => void }) => (
    <div data-testid="assistant-welcome" data-has-card={String(hasCard)}>
      <button type="button" onClick={() => onPick('Спланируй мой день')}>
        подсказка
      </button>
    </div>
  ),
}));

vi.mock('../../../shared/chat/chat-composer.js', () => ({
  ChatComposer: (
    props: Record<string, unknown> & {
      onSubmit: (submit: { text: string }) => void;
      onStop?: () => void;
      running?: boolean;
    },
  ) => {
    h.composerProps.current = props;
    return (
      <div data-testid="composer">
        <textarea data-testid="composer-input" />
        <button
          type="button"
          onClick={() => {
            const input = document.querySelector(
              '[data-testid="composer-input"]',
            ) as HTMLTextAreaElement | null;
            props.onSubmit({ text: input?.value ?? '' });
          }}
        >
          Отправить
        </button>
        {props.running ? (
          <button type="button" onClick={props.onStop}>
            Остановить
          </button>
        ) : null}
      </div>
    );
  },
}));

import { AssistantBody } from './assistant-body.js';
import { useAssistantStore } from '../model/assistant-store.js';
import { useChatDrafts } from '../../../shared/chat/chat-drafts.js';

/**
 * Тело окна ассистента (#895): шапка (заголовок, название сессии, пикер,
 * «Новый диалог», закрытие), пустое состояние, композер с оптимистичным
 * первым вопросом (сессия создаётся на лету), «Стоп» и подхват незавершённого
 * прогона. API-хуки, контекст и видимые дети замоканы — проверяется связка.
 */

const SESSION: AssistantSession = {
  id: 's-1',
  title: 'Диалог о письмах',
  archived: false,
  createdAt: '2026-11-17T08:00:00.000Z',
  updatedAt: '2026-11-17T09:00:00.000Z',
  lastMessageAt: '2026-11-17T09:00:00.000Z',
  messageCount: 2,
};

function session(id: string, title: string): AssistantSession {
  return { ...SESSION, id, title };
}

function setSessions(items: AssistantSession[], isPending = false) {
  h.sessions.mockReturnValue({ data: { items }, isPending });
}

function setMessages(items: AssistantMessage[], isPending = false) {
  h.messages.mockReturnValue({ data: { items }, isPending });
}

function renderBody() {
  return render(<AssistantBody />);
}

async function submitText(text: string) {
  fireEvent.change(screen.getByTestId('composer-input'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.composerProps.current = null;
  h.feedProps.current = null;
  setSessions([SESSION]);
  setMessages([]);
  h.create.mockReturnValue({ mutateAsync: h.createAsync, isPending: false });
  h.send.mockReturnValue({ mutate: h.sendMutate, isPending: false });
  h.cancel.mockReturnValue({ mutateAsync: h.cancelAsync });
  h.isRunActive.mockReturnValue(false);
  h.isStreamActive.mockReturnValue(true);
  h.createAsync.mockResolvedValue({ id: 's-new' });
  h.cancelAsync.mockResolvedValue(undefined);
  h.merge.mockImplementation((items: AssistantMessage[]) => [...items]);
  h.context.mockReturnValue({ moduleId: 'tasks', cardKind: 'task', cardId: 'card-1' });
  useAssistantStore.setState({
    open: true,
    activeId: 's-1',
    live: null,
    pending: null,
    dragging: false,
    width: 420,
  });
  useChatDrafts.setState({ drafts: {} });
});

afterEach(() => {
  cleanup();
  useAssistantStore.setState({ open: false, activeId: null, live: null, pending: null });
  useChatDrafts.setState({ drafts: {} });
});

describe('AssistantBody: шапка окна', () => {
  it('заголовок, название активного диалога, пикер и «Новый диалог» на месте', () => {
    renderBody();

    expect(screen.getByText(ui.assistant.title)).toBeTruthy();
    expect(screen.getByText(SESSION.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'выбрать диалог' })).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.assistant.newChat })).toBeTruthy();
    expect(screen.getByTestId('assistant-glyph')).toBeTruthy();
  });

  it('закрытие кнопкой гасит окно в сторе', () => {
    renderBody();
    fireEvent.click(screen.getByRole('button', { name: ui.assistant.close }));
    expect(useAssistantStore.getState().open).toBe(false);
  });

  it('«Новый диалог» отменяет прогон, чистит буфер и снимает активную сессию', () => {
    useAssistantStore.getState().startLive({
      runId: 'run-1',
      sessionId: 's-1',
      userText: 'вопрос',
      userMessageId: null,
    });
    useAssistantStore.setState({ pending: { text: 'ещё вопрос', at: Date.now() } });
    renderBody();

    fireEvent.click(screen.getByRole('button', { name: ui.assistant.newChat }));

    expect(h.cancelAsync).toHaveBeenCalledWith('run-1');
    expect(h.stopStream).toHaveBeenCalled();
    expect(useAssistantStore.getState().activeId).toBeNull();
    expect(useAssistantStore.getState().live).toBeNull();
    expect(useAssistantStore.getState().pending).toBeNull();
  });

  it('первое открытие выбирает последнюю сессию (ровно один раз)', () => {
    useAssistantStore.setState({ activeId: null });
    setSessions([session('s-3', 'Свежий диалог'), session('s-2', 'Старый диалог')]);
    renderBody();

    expect(useAssistantStore.getState().activeId).toBe('s-3');
  });

  it('закрытие окна останавливает поток прогона', () => {
    renderBody();
    act(() => useAssistantStore.getState().setOpen(false));
    expect(h.stopStream).toHaveBeenCalled();
  });
});

describe('AssistantBody: пустое состояние и композер', () => {
  it('пустой диалог — приглашение; подсказка отправляет вопрос в активную сессию', () => {
    renderBody();

    const welcome = screen.getByTestId('assistant-welcome');
    expect(welcome.getAttribute('data-has-card')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'подсказка' }));

    expect(h.sendMutate).toHaveBeenCalledWith(
      {
        sessionId: 's-1',
        text: ui.assistant.suggestDay,
        context: { moduleId: 'tasks', cardKind: 'task', cardId: 'card-1' },
        bypass: false,
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('идущий прогон показывает ленту, а не приглашение', () => {
    h.isRunActive.mockReturnValue(true);
    renderBody();

    expect(screen.queryByTestId('assistant-welcome')).toBeNull();
    expect(screen.getByTestId('assistant-feed')).toBeTruthy();
  });

  it('при open=false композер не монтируется (окно ещё закрыто)', () => {
    useAssistantStore.setState({ open: false });
    renderBody();
    expect(screen.queryByTestId('composer')).toBeNull();
  });

  it('первый вопрос без сессии: пузырь встаёт сразу, затем создаётся сессия', async () => {
    let resolveCreate!: (value: { id: string }) => void;
    h.createAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    useAssistantStore.setState({ activeId: null });
    setSessions([]);
    renderBody();

    await submitText('Что по задачам?');

    // POST /sessions в полёте — вопрос уже виден пузырём (I4).
    await waitFor(() => expect(h.feedProps.current).not.toBeNull());
    const pendingMessages = h.feedProps.current!.messages as AssistantMessage[];
    expect(pendingMessages).toHaveLength(1);
    expect(pendingMessages[0]).toMatchObject({ role: 'user', text: 'Что по задачам?' });
    expect(pendingMessages[0]!.id.startsWith('pending-user-')).toBe(true);
    expect(useAssistantStore.getState().pending).not.toBeNull();

    await act(async () => resolveCreate({ id: 's-new' }));

    await waitFor(() => expect(h.sendMutate).toHaveBeenCalled());
    expect(useAssistantStore.getState().activeId).toBe('s-new');
    // Пузырь НЕ исчезает между созданием сессии и стартом живого буфера:
    // pending держится, пока `live` не подхватит вопрос (замечание 18.11).
    expect(useAssistantStore.getState().pending).not.toBeNull();
    const afterCreate = h.feedProps.current!.messages as AssistantMessage[];
    expect(afterCreate.some((m) => m.role === 'user' && m.text === 'Что по задачам?')).toBe(true);
    expect(h.sendMutate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's-new', text: 'Что по задачам?' }),
      expect.anything(),
    );
  });

  it('сессия не создалась — текст возвращается в поле, отправки нет', async () => {
    h.createAsync.mockRejectedValue(new Error('сеть'));
    useAssistantStore.setState({ activeId: null });
    setSessions([]);
    renderBody();

    await submitText('Не потеряй меня');

    await waitFor(() =>
      expect(useChatDrafts.getState().drafts.assistant?.text).toBe('Не потеряй меня'),
    );
    expect(h.sendMutate).not.toHaveBeenCalled();
    expect(useAssistantStore.getState().pending).toBeNull();
  });

  it('повторный сабмит при летящей отправке молча отбрасывается', async () => {
    h.send.mockReturnValue({ mutate: h.sendMutate, isPending: true });
    renderBody();

    await submitText('дубль');

    expect(h.sendMutate).not.toHaveBeenCalled();
    expect(h.createAsync).not.toHaveBeenCalled();
  });

  it('пустой сабмит ничего не отправляет', async () => {
    renderBody();
    await submitText('   ');
    expect(h.sendMutate).not.toHaveBeenCalled();
  });

  it('«Стоп» отменяет прогон и переводит буфер в cancelled', async () => {
    h.isRunActive.mockReturnValue(true);
    useAssistantStore.getState().startLive({
      runId: 'run-stop',
      sessionId: 's-1',
      userText: 'вопрос',
      userMessageId: null,
    });
    renderBody();

    fireEvent.click(screen.getByRole('button', { name: ui.assistant.stop }));

    await waitFor(() => expect(h.cancelAsync).toHaveBeenCalledWith('run-stop'));
    expect(useAssistantStore.getState().live?.status).toBe('cancelled');
  });

  it('новый вопрос в идущем прогоне останавливает предыдущий', async () => {
    useAssistantStore.getState().startLive({
      runId: 'run-old',
      sessionId: 's-1',
      userText: 'старый',
      userMessageId: null,
    });
    renderBody();

    await submitText('Новый вопрос');

    await waitFor(() => expect(h.cancelAsync).toHaveBeenCalledWith('run-old'));
    expect(h.sendMutate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's-1', text: 'Новый вопрос' }),
      expect.anything(),
    );
  });

  it('упавшая отправка в существующей сессии возвращает текст в поле', async () => {
    h.send.mockReturnValue({
      mutate: vi.fn((_input: unknown, options: { onError?: () => void }) => {
        options.onError?.();
      }),
      isPending: false,
    });
    renderBody();

    await submitText('Верни меня');

    await waitFor(() => expect(useChatDrafts.getState().drafts.assistant?.text).toBe('Верни меня'));
  });
});
