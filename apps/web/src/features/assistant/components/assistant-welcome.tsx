import { ui } from '@nodus/contracts';

import { AssistantGlyph } from './assistant-feed.js';

/** Пустой диалог: приглашение и контекстные подсказки тихими строками
 *  (без outline-«уголков» — канон панелей). */
export function AssistantWelcome({
  hasCard,
  onPick,
}: {
  hasCard: boolean;
  onPick: (text: string) => void;
}) {
  const suggestions = [
    ui.assistant.suggestDay,
    ui.assistant.suggestOverdue,
    ...(hasCard ? [ui.assistant.suggestCard] : []),
    ui.assistant.suggestLetter,
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-6">
      <AssistantGlyph className="size-12 rounded-xl [&>svg]:size-6" />
      <div className="text-center">
        <div className="text-lg font-semibold text-foreground">{ui.assistant.welcomeTitle}</div>
        <p className="mt-1 max-w-72 text-sm leading-snug text-muted-foreground">
          {ui.assistant.welcomeBody}
        </p>
      </div>
      <div className="flex w-full max-w-72 flex-col gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-lg bg-muted/60 px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
