import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useChatPrefs, type ChatAlign } from '../../../shared/chat/chat-prefs.js';

/** Плитка-радио с мини-схемой ленты (модель Битрикс24 «Выравнивание
 *  сообщений»: выбор виден на превью, а не в тексте). */
function AlignTile({
  active,
  label,
  preview,
  onPick,
}: {
  active: boolean;
  label: string;
  preview: ReactNode;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className={cn(
        'flex w-44 flex-col gap-2 rounded-xl border border-border bg-card p-2 text-left transition-colors hover:border-input',
        active && 'border-primary ring-1 ring-primary',
      )}
    >
      <span className="flex h-20 flex-col justify-center gap-1.5 rounded-lg bg-chat-zone p-2">
        {preview}
      </span>
      <span className="flex items-center gap-1.5 text-xs text-foreground">
        {label}
        {active ? <Check className="ml-auto size-3.5 text-primary" strokeWidth={2.25} /> : null}
      </span>
    </button>
  );
}

/* Превью зеркалит пузыри ленты (#127): заливки bubble-in/bubble-out, без рамки
   (пузыри канонически без рамки — bubble.tsx). */
const bubbleIn = 'h-3 w-16 rounded-md bg-bubble-in';
const bubbleMine = 'h-3 w-16 rounded-md bg-bubble-out';

/**
 * Настройка мессенджера (вердикт владельца 14.09.2026: подмодуль «Настройка»
 * как в Битрикс24): раздел «Оформление» — выравнивание сообщений ленты
 * ('one' — все с одной стороны, дефолт; 'both' — свои справа). Персист —
 * `nodus-chat-prefs-v1` (shared/chat/chat-prefs.ts); серверные персональные
 * настройки — после MVP.
 */
export function ChatSettings() {
  const align = useChatPrefs((s) => s.align);
  const setAlign = useChatPrefs((s) => s.setAlign);

  const pick = (value: ChatAlign) => () => setAlign(value);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">{ui.chat.settingsAppearance}</h2>
          <div role="radiogroup" aria-label={ui.chat.alignTitle} className="flex flex-wrap gap-3">
            <AlignTile
              active={align === 'one'}
              label={ui.chat.alignOne}
              onPick={pick('one')}
              preview={
                <>
                  <span className={bubbleIn} />
                  <span className={bubbleMine} />
                </>
              }
            />
            <AlignTile
              active={align === 'both'}
              label={ui.chat.alignBoth}
              onPick={pick('both')}
              preview={
                <>
                  <span className={bubbleIn} />
                  <span className={cn(bubbleMine, 'ml-auto')} />
                </>
              }
            />
          </div>
          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
            {ui.chat.alignHint}
          </p>
        </section>
      </div>
    </div>
  );
}
