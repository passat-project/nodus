// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { AssistantMessage, AssistantSession } from '@nodus/contracts';

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
 * Подхват незавершённого прогона в теле окна ассистента (#895, #896): сервер
 * продолжает ответ после закрытия/перезагрузки, клиент обязан подписаться
 * заново — и при открытии, и после закрытия во время ответа (иначе
 * «печатается» замёрзнет без стопа и без текста). Связка с повторной
 * отправкой вопроса — `assistant-body.test.tsx`.
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

let messageSeq = 0;

function message(
  role: AssistantMessage['role'],
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  messageSeq += 1;
  return {
    id: `40000000-0000-4000-8000-${String(messageSeq).padStart(12, '0')}`,
    role,
    text: '',
    reasoning: null,
    createdAt: '2026-11-17T09:00:00.000Z',
    runId: null,
    streaming: false,
    errorCode: null,
    toolCalls: [],
    actions: [],
    actionBatch: null,
    ...overrides,
  };
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

beforeEach(() => {
  vi.clearAllMocks();
  messageSeq = 0;
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

describe('AssistantBody: лента, повтор и подхват прогона', () => {
  it('«Повторить» переотправляет последний вопрос сотрудника', () => {
    setMessages([
      message('user', { text: 'Сколько задач?' }),
      message('assistant', { text: '', errorCode: 'provider_error' }),
    ]);
    renderBody();

    act(() => {
      (h.feedProps.current!.onRetry as () => void)();
    });

    expect(h.sendMutate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's-1', text: 'Сколько задач?' }),
      expect.anything(),
    );
  });

  it('незавершённый прогон в истории подхватывается по runId', () => {
    h.isStreamActive.mockReturnValue(false);
    const last = message('assistant', { streaming: true, runId: 'run-live' });
    setMessages([message('user', { text: 'вопрос' }), last]);
    renderBody();

    expect(h.recover).toHaveBeenCalledWith('run-live', 's-1', last.id);
  });

  it('живой поток той же сессии повторно не подписывается', () => {
    const last = message('assistant', { streaming: true, runId: 'run-live' });
    setMessages([message('user', { text: 'вопрос' }), last]);
    useAssistantStore.getState().startLive({
      runId: 'run-live',
      sessionId: 's-1',
      userText: '',
      userMessageId: null,
    });
    renderBody();

    expect(h.recover).not.toHaveBeenCalled();
  });

  it('закрытие окна во время ответа и повторное открытие подписываются заново', () => {
    h.isStreamActive.mockReturnValue(false);
    const last = message('assistant', { streaming: true, runId: 'run-live' });
    setMessages([message('user', { text: 'вопрос' }), last]);
    renderBody();
    expect(h.recover).toHaveBeenCalledTimes(1);

    act(() => useAssistantStore.setState({ open: false }));
    expect(h.stopStream).toHaveBeenCalled();

    act(() => useAssistantStore.setState({ open: true }));
    // Буфер прогона тот же, но поток оборван закрытием — подписка нужна снова.
    expect(h.recover).toHaveBeenCalledTimes(2);
    expect(h.recover).toHaveBeenLastCalledWith('run-live', 's-1', last.id);
  });

  it('последнее сообщение не стримится — подхвата нет', () => {
    setMessages([message('user', { text: 'вопрос' }), message('assistant', { text: 'ответ' })]);
    renderBody();
    expect(h.recover).not.toHaveBeenCalled();
  });
});
