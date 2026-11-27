import { cn } from '@nodus/ui/lib/utils';

/**
 * Ряд образцов цвета-идентичности типа (ревизия UI v3, #857): круглые
 * кнопки-точки; выбранная — кольцо `ring-ring` с отступом (та же грамматика,
 * что у палитры стадии в канбане: кольцо отделено от заливки, поэтому
 * читается и на сером, и на насыщенном тоне; прежняя рамка
 * `border-foreground` сливалась с серым образцом), имя цвета — в
 * `aria-label`/`title`. Один калибр для типов задачи, письма, проекта и
 * папки: окно настроек показывает его ПОД подписью «Цвет», и он помещается
 * без горизонтальной прокрутки.
 */
export function ColorSwatchRow<T extends string>({
  ariaLabel,
  value,
  options,
  swatchOf,
  nameOf,
  disabled,
  onSelect,
}: {
  /** Доступное имя группы («Цвет»): подпись поля — простой текст, не label. */
  ariaLabel: string;
  value: T;
  options: readonly T[];
  /** Класс тона точки (токен темы). */
  swatchOf: (option: T) => string;
  nameOf: (option: T) => string;
  disabled?: boolean;
  onSelect: (option: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          aria-label={nameOf(option)}
          title={nameOf(option)}
          disabled={disabled}
          onClick={() => value !== option && onSelect(option)}
          className={cn(
            'size-6 rounded-full border-2 border-transparent transition-shadow disabled:cursor-default',
            swatchOf(option),
            value === option
              ? 'ring-2 ring-ring ring-offset-2 ring-offset-popover'
              : 'hover:ring-2 hover:ring-border hover:ring-offset-2 hover:ring-offset-popover',
          )}
        />
      ))}
    </div>
  );
}
