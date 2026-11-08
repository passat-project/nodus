import { ChevronRight, Trash2, type LucideIcon } from 'lucide-react';
import { Button } from '@nodus/ui/components/button';
import { Switch } from '@nodus/ui/components/switch';
import { cn } from '@nodus/ui/lib/utils';

import { SegmentedControl } from '../segmented-control.js';

/**
 * Примитивы правой панели окна-сплита (#378 ред. 2; общий кит, #556) — грамматика для
 * панелей статуса, кнопки, окна создания и настроек типа: поле с подписью,
 * строка-переключатель, строка «Название ›» со сводкой (раздел или
 * связанный элемент — переход внутрь, модель Трекера), выбор режима
 * строками, сегменты, тихое действие, опасное действие внизу. Всё
 * переносится — без обрезки по горизонтали (`min-w-0`, `break-words`).
 */

/** Фокус в название нового элемента — БЕЗ прокрутки: панель ещё выезжает
 *  (обёртка overflow-hidden), обычный focus() сдвинул бы её содержимое. */
export function focusName(input: HTMLInputElement | null): void {
  if (!input) return;
  input.focus({ preventScroll: true });
  input.select();
}

export function PanelField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs break-words text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/** Пояснение панели на ступени тона (форма по умолчанию, заблокированный
 *  раздел): заголовок и текст, без рамки и иконок. */
export function PanelNote({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-accent/50 px-3 py-2">
      {title ? <span className="text-sm">{title}</span> : null}
      <span className="text-xs break-words text-muted-foreground">{children}</span>
    </div>
  );
}

/** Строка-переключатель: название, пояснение, тумблер справа. Тумблер
 *  центрирован по ПЕРВОЙ строке названия (обёртка в line-height text-sm). */
export function SwitchRow({
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex min-w-0 items-start justify-between gap-3',
        disabled ? 'cursor-default' : 'cursor-pointer',
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">{title}</span>
        {hint ? <span className="text-xs break-words text-muted-foreground">{hint}</span> : null}
      </span>
      <span className="flex h-[22px] shrink-0 items-center">
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </span>
    </label>
  );
}

/** Строка «Название ›»: раздел панели или связанный элемент (кнопка
 *  статуса); сводка — текущие настройки; `actions` — доп. кнопки строки. */
export function SectionLink({
  title,
  summary,
  onClick,
  actions,
}: {
  title: string;
  summary: string;
  onClick: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="group -mx-2 flex min-w-0 items-center gap-1 rounded-lg px-2 transition-colors hover:bg-accent/60">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm break-words">{title}</span>
          <span className="text-xs break-words text-muted-foreground">{summary}</span>
        </span>
      </button>
      {actions}
      {/* Шеврон — часть кликабельной строки (дубль основной кнопки для мыши). */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClick}
        className="flex self-stretch items-center"
      >
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** Тихое действие панели («+ Поле», «Посмотреть окно», «+ Добавить
 *  переход»): ghost-кнопка без заливки и рамки, отклик — подложка на ховере.
 *  Заливка primary — только у главного действия окна («Опубликовать»,
 *  «Создать»); outline-кнопок в панелях нет (вердикт владельца 26.10.2026). */
export function PanelAction({
  icon: Icon,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { icon: LucideIcon }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('-ml-2 self-start', className)}
      {...props}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
      {children}
    </Button>
  );
}

/** Выбор режима строками, а не сегментами: длинная подпись в сегменте
 *  обрезалась (#380 «Если ещё не списаны», #432 «Никто, кроме
 *  администратора» — замечания владельца). Под подписью — пояснение. */
export function ModeChoices<T extends string>({
  value,
  options,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string; hint: string }[];
  disabled: boolean;
  ariaLabel?: string;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex min-w-0 flex-col gap-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-w-0 items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors disabled:cursor-default',
              active ? 'border-primary bg-primary/5' : 'border-border enabled:hover:bg-accent/60',
              disabled && !active && 'opacity-60',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 size-3.5 shrink-0 rounded-full border',
                active
                  ? 'border-primary bg-primary ring-2 ring-primary/20'
                  : 'border-muted-foreground/50',
              )}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm">{option.label}</span>
              <span className="text-xs break-words text-muted-foreground">{option.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  disabled,
  layout,
  className,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  /** `grid` + `className="w-full"` — равные сегменты на всю ширину панели:
   *  длинные подписи («По желанию», «Обязательно») не обрезаются. */
  layout?: 'flex' | 'grid';
  className?: string;
  onChange: (value: T) => void;
}) {
  return (
    <SegmentedControl
      value={value}
      options={options}
      disabled={disabled}
      layout={layout}
      className={className}
      onChange={onChange}
    />
  );
}

/** Опасное/необратимое действие внизу панели. Значок по умолчанию —
 *  корзина; возврат из архива передаёт свой (`RotateCcw`): корзина у
 *  «Вернуть» читалась как удаление. */
export function PanelDanger({
  onClick,
  icon: Icon = Trash2,
  children,
}: {
  onClick: () => void;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      className="mt-auto h-auto min-h-8 justify-start py-1.5 text-left whitespace-normal text-danger hover:text-danger"
      onClick={onClick}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </Button>
  );
}
