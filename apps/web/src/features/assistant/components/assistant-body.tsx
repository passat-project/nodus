import { Plus, X } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { ChatComposer } from '../../../shared/chat/chat-composer.js';
import { useAssistantStore } from '../model/assistant-store.js';
import { buildReply } from '../model/mock-engine.js';
import { useAssistantContext } from '../model/use-assistant-context.js';
import { AssistantFeed, AssistantGlyph } from './assistant-feed.js';
import { AssistantSessionPicker } from './assistant-session-picker.js';
import { AssistantWelcome } from './assistant-welcome.js';

/** Тело окна ассистента: шапка h-14 (калибр топбара) с глифом, заголовком
 *  «ИИ-ассистент», названием сессии мелким текстом, пикером диалогов,
 *  «Новый диалог» и закрытием; лента и композер — канон мессенджера.
 *  При открытии панели — сразу ПОСЛЕДНЯЯ сессия (прошлый чат). */
export function AssistantBody() {
  const open = useAssistantStore((s) => s.open);
  const sessions = useAssistantStore((s) => s.sessions);
  const activeId = useAssistantStore((s) => s.activeId);
  const thinking = useAssistantStore((s) => s.thinkingId !== null && s.thinkingId === s.activeId);
  const send = useAssistantStore((s) => s.send);
  const newSession = useAssistantStore((s) => s.newSession);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const ctx = useAssistantContext();

  const active = sessions.find((s) => s.id === activeId) ?? null;

  function ask(text: string) {
    send(text, buildReply(text, ctx));
  }

  return (
    <>
      {/* Шапка h-14 — КАЛИБР ТОПБАРА: её нижняя линия совпадает с осью
          контура и верхней границей бара беседы мессенджера (вердикт
          владельца 16.11.2026: все горизонтали совпадают). */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <AssistantGlyph className="size-7" />
        <span className="shrink-0 text-sm font-semibold text-foreground">{ui.assistant.title}</span>
        {/* Название сессии — мелким текстом возле заголовка панели, без
            отдельного бара (вердикт владельца 16.11.2026). */}
        <span className="min-w-0 flex-1 truncate text-label text-muted-foreground">
          {active?.title ?? ui.assistant.newChat}
        </span>
        <AssistantSessionPicker />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={newSession}
          aria-label={ui.assistant.newChat}
          title={ui.assistant.newChat}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setOpen(false)}
          aria-label={ui.assistant.close}
          title={ui.assistant.close}
        >
          <X className="size-4" />
        </Button>
      </header>
      {/* Зона ленты с обоями продолжается ПОД композером до низа окна —
          островок ввода парит на ней, как в мессенджере (не на белом хроме).
          Бар сессии h-14 — калибр бара беседы мессенджера: обои начинаются
          на той же горизонтали, что лента мессенджера под баром беседы. */}
      {/* Без вертикального hairline слева (вердикт владельца 16.11.2026):
          край окна читается скруглением и тенью в светлой теме и ступенью
          тона зоны в тёмной; линия в шапке/баре сессии не нужна. */}
      <div className="chat-wallpaper flex min-h-0 flex-1 flex-col bg-chat-zone">
        {active && active.messages.length === 0 && !thinking ? (
          <AssistantWelcome hasCard={!!ctx.cardTask} onPick={ask} />
        ) : (
          <AssistantFeed messages={active?.messages ?? []} thinking={thinking} />
        )}
        {/* Канонический композер мессенджера: монтируется только при открытой
            панели — «вечный курсор» не ворует фокус у скрытой панели. */}
        {open ? (
          <ChatComposer
            placeholder={ui.assistant.composerPlaceholder}
            focusId="assistant"
            attachmentsEnabled={false}
            stickersEnabled={false}
            urgentEnabled={false}
            onSubmit={(submit) => {
              if (submit.text.trim()) ask(submit.text.trim());
            }}
          />
        ) : null}
      </div>
    </>
  );
}
