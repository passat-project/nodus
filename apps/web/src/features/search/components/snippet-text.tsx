import { SEARCH_SNIPPET_END, SEARCH_SNIPPET_START } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

export interface SnippetPart {
  text: string;
  marked: boolean;
}

/**
 * Разбор сниппета сервера по маркерам `\u0001`/`\u0002`. Фронт рендерит
 * ТОЛЬКО текстовые узлы (никакого HTML/dangerouslySetInnerHTML): сервер
 * вырезает C0-символы из данных, поэтому маркеры не могут встретиться в
 * тексте (#952 Р8). Непарные маркеры безопасно игнорируются.
 */
export function splitSnippet(raw: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let marked = false;
  let buffer = '';
  for (const char of raw) {
    if (char === SEARCH_SNIPPET_START || char === SEARCH_SNIPPET_END) {
      if (buffer !== '') parts.push({ text: buffer, marked });
      buffer = '';
      marked = char === SEARCH_SNIPPET_START;
      continue;
    }
    buffer += char;
  }
  if (buffer !== '') parts.push({ text: buffer, marked });
  return parts;
}

export function SnippetText({ text, className }: { text: string; className?: string }) {
  const parts = splitSnippet(text);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.marked ? (
          <mark key={index} className="rounded-sm bg-accent px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}

/** Класс сниппета в списке: ОДНА строка с обрезом (плотная строка выдачи —
 *  два слоя текста, вердикт владельца 18.11.2026). */
export const snippetClassName = cn('block truncate text-xs leading-4 text-muted-foreground');
