import { useEffect, useRef } from 'react';
import { Plus, Square, X } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { ChatComposer } from '../../../shared/chat/chat-composer.js';
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
  const setActive = useAssistantStore((state) => state.setActive);
  const setOpen = useAssistantStore((state) => state.setOpen);

  const sessionsQuery = useAssistantSessions();
  const messagesQuery = useAssistantMessages(activeId);
  const createSession = useCreateAssistantSession();
  const sendMessage = useSendAssistantMessage();
  const cancelRun = useCancelAssistantRun();
  const running = useIsRunActive(activeId);
  const ctx = useAssistantContext();

  const sessions = sessionsQuery.data?.items;
  const active = sessions?.find((session) => session.id === activeId) ?? null;
  const messages = mergeLiveMessage(messagesQuery.data?.items ?? [], live, activeId);
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

  async function ask(text: string) {
    const prompt = text.trim();
    if (!prompt) return;
    let sessionId = activeId;
    if (!sessionId) {
      const session = await createSession.mutateAsync();
      setActive(session.id);
      sessionId = session.id;
    }
    sendMessage.mutate({
      sessionId,
      text: prompt,
      context: {
        moduleId: ctx.moduleId,
        cardKind: ctx.cardKind,
        cardId: ctx.cardId,
      },
    });
  }

  function newChat() {
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
      {/* Шапка h-14 — КАЛИБР ТОПБАРА: её нижняя линия совпадает с осью
          контура и верхней границей бара беседы мессенджера. */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <AssistantGlyph className="size-7" />
        <span className="shrink-0 text-sm font-semibold text-foreground">{strings.title}</span>
        <span className="min-w-0 flex-1 truncate text-label text-muted-foreground">
          {active?.title ?? strings.newChat}
        </span>
        {running ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-destructive hover:bg-destructive/10"
            onClick={stop}
            aria-label={strings.stop}
            title={strings.stop}
          >
            <Square className="size-4" />
          </Button>
        ) : null}
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
            onSubmit={(submit) => {
              const text = submit.text.trim();
              if (text) void ask(text);
            }}
          />
        ) : null}
      </div>
    </>
  );
}
