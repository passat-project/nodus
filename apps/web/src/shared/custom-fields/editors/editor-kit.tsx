import { ChevronDown } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import type { CustomFieldDefinition, CustomFieldRef, CustomFieldValue } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/** Вариант редактора: `inline` — правка по месту в карточке (значение
 *  выглядит текстом, клик открывает ввод), `form` — постоянный контрол
 *  (окно перехода, форма типа). */
export type EditorVariant = 'inline' | 'form';

export interface EditorProps {
  definition: CustomFieldDefinition;
  value: CustomFieldValue | undefined;
  refs: readonly CustomFieldRef[];
  disabled: boolean;
  variant: EditorVariant;
  /** `refs` — ссылка выбранного значения: оптимистичная правка кладёт её в
   *  кэш сразу, не дожидаясь ответа сервера (Р6). */
  onCommit: (value: CustomFieldValue | null, refs?: CustomFieldRef[]) => void;
}

/**
 * Ввод правки по месту — ТОГО ЖЕ габарита, что строка-значение триггера
 * (баг-вердикт владельца 25.10.2026: поле многострочного текста при
 * активации было выше строки и сдвигало карточку): h-7, внешний -mx-1,
 * отступ px-1 за вычетом рамки 1px — текст не смещается ни по X, ни по Y.
 * В форме (окно перехода, умолчание) — обычный контрол h-8.
 */
export function editorInputClass(variant: EditorVariant): string {
  return variant === 'inline' ? '-mx-1 h-7 px-[calc(0.25rem-1px)] py-0' : 'h-8';
}

/** Многострочный ввод: строка + py (0.25rem − рамка) + рамка = высота строки
 *  многострочного триггера (py-1 + строка); рост — по тексту. Класс ставить
 *  ПОСЛЕ text-sm: tailwind-merge иначе выбрасывает leading-5. */
export function editorTextareaClass(variant: EditorVariant): string {
  return variant === 'inline'
    ? '-mx-1 min-h-7 w-[calc(100%+0.5rem)] resize-none px-[calc(0.25rem-1px)] py-[calc(0.25rem-1px)] leading-5'
    : 'min-h-16';
}

/** Триггер выбора: в карточке — строка-значение с ховер-заливкой, в форме —
 *  контрол в рамке, как у системных полей окна. `multiline` — абзацы на всю
 *  ширину (многострочный текст): без обрезки, вертикальный отступ под ввод. */
export function EditorTrigger({
  children,
  variant,
  disabled,
  ariaLabel,
  open,
  multiline = false,
  onClick,
  onPointerDown,
  ref,
}: {
  children: ReactNode;
  variant: EditorVariant;
  disabled: boolean;
  ariaLabel: string;
  open?: boolean;
  multiline?: boolean;
  onClick?: () => void;
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  /** React 19: ref — обычный проп; нужен Radix `asChild` (поповеры пикеров). */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-left text-sm transition-colors disabled:cursor-default',
        variant === 'inline'
          ? '-mx-1 min-h-7 rounded-md px-1 hover:bg-accent/40 focus-visible:bg-accent/40'
          : 'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 hover:bg-accent/40 dark:bg-input/30',
        multiline && variant === 'inline' && 'w-[calc(100%+0.5rem)] items-start py-1 leading-5',
        open && 'bg-accent/40',
      )}
    >
      <span
        className={cn('min-w-0 flex-1', multiline ? 'break-words whitespace-pre-line' : 'truncate')}
      >
        {children}
      </span>
      {variant === 'form' ? (
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      ) : null}
    </button>
  );
}

/** Подсказка ошибки под контролем (aria-describedby у вызывающего). */
export function EditorError({ id, text }: { id: string; text: string }) {
  return (
    <p id={id} className="text-xs text-danger">
      {text}
    </p>
  );
}
