import { useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { ui, type AssistantMessage } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { ChatComposer } from '../../../shared/chat/chat-composer.js';
import { useChatDrafts } from '../../../shared/chat/chat-drafts.js';
import {
  mergeLiveMessage,
  stopRunStream,
  useAssistantMessages,
  useAssistantSessions,
  useCancelAssistantRun,
  useCreateAssistantSession,
  useIsRunActive,
  useSendAssistantMessage,
} from '../api/assistant-api.js';
import { useAssistantStore } from '../model/assistant-store.js';
import { useAssistantContext } from '../model/use-assistant-context.js';
import { AssistantFeed, AssistantGlyph } from './assistant-feed.js';
import { AssistantSessionPicker } from './assistant-session-picker.js';
import { AssistantWelcome } from './assistant-welcome.js';

const strings = ui.assistant;

/**
 * Тело окна ассистента (#895): шапка h-14 (калибр топбара) с глифом,
 * заголовком, названием сессии, пикером, «Новый диалог», «Стоп» и закрытием;
 * лента и композер — канон мессенджера.
 *
 * Данные — серверные (TanStack Query): сессии и история сохраняются после
 * перезагрузки. Живой ответ печатается из потока прогона; при первом
 * открытии панели показывается ПОСЛЕДНЯЯ сессия.
 */
export function AssistantBody() {
  const open = useAssistantStore((state) => state.open);
  const activeId = useAssistantStore((state) => state.activeId);
  const live = useAssistantStore((state) => state.live);
  const pending = useAssistantStore((state) => state.pending);
  const setActive = useAssistantStore((state) => state.setActive);
  const setOpen = useAssistantStore((state) => state.setOpen);
  const setPending = useAssistantStore((state) => state.setPending);

  const sessionsQuery = useAssistantSessions();
  const messagesQuery = useAssistantMessages(activeId);
  const createSession = useCreateAssistantSession();
  const sendMessage = useSendAssistantMessage();
  const cancelRun = useCancelAssistantRun();
  const running = useIsRunActive(activeId);
  const ctx = useAssistantContext();

  const sessions = sessionsQuery.data?.items;
  const active = sessions?.find((session) => session.id === activeId) ?? null;
  const base = mergeLiveMessage(messagesQuery.data?.items ?? [], live, activeId);
  // Первый вопрос «Нового диалога»: сессии ещё нет, POST /sessions в полёте —
  // пузырь уже в ленте (I4: как в мессенджере, без ожидания сервера).
  const messages: AssistantMessage[] =
    pending && !live ? [...base, pendingAssistantMessage(pending)] : base;
  const empty = messages.length === 0;

  // Первое открытие панели — прошлый чат (вердикт владельца 16.11.2026):
  // ровно один раз, дальше выбор сотрудника не перебиваем.
  const initialized = useRef(false);
  useEffect(() => {
    if (!open || initialized.current || sessionsQuery.isPending) return;
    initialized.current = true;
    if (!activeId) setActive(sessions?.[0]?.id ?? null);
  }, [open, sessionsQuery.isPending, sessions, activeId, setActive]);

  // Закрытие окна не бросает прогон в фоне: поток закрывается, сервер
  // доведёт ответ и сохранит его (повторное открытие покажет результат).
  useEffect(() => {
    if (!open) stopRunStream();
  }, [open]);

  const lastUserText =
    [...messages].reverse().find((message) => message.role === 'user')?.text ?? '';

  async function ask(text: string, onFail?: () => void) {
    const prompt = text.trim();
    if (!prompt) return;
    // Двойной клик по «Отправить» (и Enter дважды) не рождает второй прогон:
    // пока POST в полёте, повтор молча отбрасывается.
    if (sendMessage.isPending || createSession.isPending) return;
    let sessionId = activeId;
    if (!sessionId) {
      // Пузырь вопроса — ДО создания сессии: иначе первый вопрос ждал бы
      // сетевой ответ `POST /sessions` (замер 17.11: 89 мс против 16 мс).
      setPending(prompt);
      try {
        const session = await createSession.mutateAsync();
        setActive(session.id);
        sessionId = session.id;
      } catch {
        setPending(null);
        onFail?.();
        return;
      }
      // Сессия есть — временную строку дальше ведёт кэш истории (onMutate).
      setPending(null);
    }
    // Один живой прогон на вкладку: новый вопрос останавливает предыдущий,
    // иначе старый прогон догорал бы на сервере без слушателя.
    const current = useAssistantStore.getState().live;
    if (current?.status === 'running' && current.sessionId === sessionId) {
      void cancelRun.mutateAsync(current.runId).catch(() => undefined);
    }
    sendMessage.mutate(
      {
        sessionId,
        text: prompt,
        context: {
          moduleId: ctx.moduleId,
          cardKind: ctx.cardKind,
          cardId: ctx.cardId,
        },
      },
      // Канон мессенджера #124/#248: поле очищается на сабмите (мгновенно,
      // модель Telegram), упавшая отправка возвращает текст в поле.
      { onError: () => onFail?.() },
    );
  }

  function newChat() {
    // Уход из диалога не оставляет прогон сиротой на сервере.
    if (live?.status === 'running') void cancelRun.mutateAsync(live.runId).catch(() => undefined);
    setPending(null);
    stopRunStream();
    useAssistantStore.getState().clearLive();
    setActive(null);
  }

  function stop() {
    if (live) void cancelRun.mutateAsync(live.runId).catch(() => undefined);
    useAssistantStore.getState().finishLive('cancelled');
  }

  return (
    <>
      {/* Шапка — КАЛИБР ТОПБАРА h-14 МИНУС 1px верхнего бордюра окна
          (замечание владельца 17.11.2026): бордюр не сдвигает контент, и
          нижняя линия шапки пиксель-в-пиксель совпадает с разделителем
          карточки мессенджера (h-14); линия графа на оси рисуется поверх
          верхнего бордюра окна. */}
      <header className="flex h-[calc(3.5rem-1px)] shrink-0 items-center gap-2 border-b border-border px-3">
        <AssistantGlyph className="size-7" />
        <span className="shrink-0 text-sm font-semibold text-foreground">{strings.title}</span>
        <span className="min-w-0 flex-1 truncate text-label text-muted-foreground">
          {active?.title ?? strings.newChat}
        </span>
        <AssistantSessionPicker onNewChat={newChat} />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={newChat}
          aria-label={strings.newChat}
          title={strings.newChat}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setOpen(false)}
          aria-label={strings.close}
          title={strings.close}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="chat-wallpaper flex min-h-0 flex-1 flex-col bg-chat-zone">
        {empty && !running ? (
          <AssistantWelcome hasCard={Boolean(ctx.cardKind)} onPick={(text) => void ask(text)} />
        ) : (
          <AssistantFeed
            messages={messages}
            live={live}
            activeSessionId={activeId}
            onRetry={() => void ask(lastUserText)}
          />
        )}
        {open ? (
          <ChatComposer
            placeholder={strings.composerPlaceholder}
            focusId="assistant"
            attachmentsEnabled={false}
            stickersEnabled={false}
            urgentEnabled={false}
            /* Вердикт владельца 17.11.2026: смайлов нет — их слот занимает
               микрофон (аудиозапись в будущем); отправка видна всегда, во
               время прогона в том же слоте — красный «Остановить». */
            emojiPicker={false}
            alwaysShowSend
            running={running}
            onStop={stop}
            stopLabel={strings.stop}
            onSubmit={(submit) => {
              const text = submit.text.trim();
              if (!text) return;
              useChatDrafts.getState().setText('assistant', '');
              void ask(text, () => {
                useChatDrafts.getState().restoreFailedSend('assistant', {
                  wireText: text,
                  reply: null,
                  urgent: false,
                  attachments: [],
                });
              });
            }}
          />
        ) : null}
      </div>
    </>
  );
}

/** Временный вопрос «Нового диалога»: та же форма, что у серверной строки,
 *  чтобы лента рисовала его каноничным пузырём без спецслучаев. */
function pendingAssistantMessage(pending: { text: string; at: number }): AssistantMessage {
  return {
    id: `pending-user-${pending.at}`,
    role: 'user',
    text: pending.text,
    reasoning: null,
    createdAt: new Date(pending.at).toISOString(),
    runId: null,
    streaming: false,
    errorCode: null,
    toolCalls: [],
  };
}
