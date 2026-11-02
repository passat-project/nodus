import { Info, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';

/** Поле инспектора сущности: дескриптор (иконка + метка + рендер значения).
 *  Системные поля сущности описываются реестром в фиче; кастомные поля
 *  (атрибуты) живут отдельным блоком `CustomFieldsBlock` (#431) в той же
 *  грамматике строки. */
export interface EntityFieldDef {
  key: string;
  icon: ReactNode;
  label: string;
  /** Обязательное поле формы (карточка-письмо до регистрации, редизайн
   *  #56): у метки — звёздочка, пустое значение подсвечивает фича. */
  required?: boolean;
  render: () => ReactNode;
}

function readHidden(storageKey: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** Видимость полей сущности: скрытые ключи в localStorage (свой ключ на
 *  сущность: nodus-<entity>-fields-v1), toggle пишет сразу. */
export function useFieldVisibility(storageKey: string) {
  const [hiddenKeys, setHiddenKeys] = useState<string[]>(() => readHidden(storageKey));

  function toggle(key: string) {
    setHiddenKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }

  return { hiddenKeys, toggle };
}

/** Строка поля: «иконка (lucide 3.5, muted) + моно-метка w-44 / значение»
 *  без табличных рамок, ховер-заливка строки. Значения НЕ сокращаются:
 *  на узкой зоне значение переносится под метку (min-w, вердикт владельца).
 *  Подсказка поля (#431) — title метки и aria-describedby значения (id
 *  скрытого текста даёт вызывающий). `wide` — строка на всю ширину сетки
 *  (многострочный текст, как описание задачи): метка у первой строки. */
export function FieldRow({
  icon,
  label,
  hint,
  hintId,
  wide = false,
  stacked = false,
  required = false,
  requiredText,
  children,
}: {
  icon: ReactNode;
  label: string;
  hint?: string | null;
  hintId?: string;
  wide?: boolean;
  /** Узкая зона (правая панель 320px): метка над значением, а не в колонке
   *  w-44 — иначе метка стоит одна в пустой строке. */
  stacked?: boolean;
  required?: boolean;
  /** Подпись обязательности словами («обязательно») вместо звёздочки —
   *  форма папки (#556): состояние поля читается, а не угадывается. */
  requiredText?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        '-mx-2 flex rounded-md px-2 py-2 transition-colors hover:bg-accent/40',
        stacked ? 'flex-col items-stretch gap-1' : 'flex-wrap items-center gap-3',
        wide && 'items-start @min-[55rem]:col-span-2',
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground',
          stacked ? 'w-full' : 'w-44',
          wide && 'min-h-7',
        )}
        title={hint ?? undefined}
      >
        <span aria-hidden className="shrink-0 opacity-70">
          {icon}
        </span>
        <span className="truncate">{label}</span>
        {/* Обязательное поле: слово-метка (#556) или тонкая звёздочка в тоне
            действия; прижата к слову (gap-2 метки оставляла бы её «висящей»). */}
        {required && requiredText ? (
          <span className="-ml-1 shrink-0 text-[11px] font-normal text-muted-foreground">
            · {requiredText}
          </span>
        ) : required ? (
          <span aria-hidden className="-ml-1 shrink-0 text-primary">
            *
          </span>
        ) : null}
        {hint ? (
          <Info className="size-3 shrink-0 opacity-50" strokeWidth={1.75} aria-hidden />
        ) : null}
      </span>
      <span
        className={cn(
          'flex min-h-8 items-center gap-2 text-sm',
          stacked ? 'w-full' : 'min-w-[10rem] flex-1',
          wide && 'items-start',
        )}
        aria-describedby={hint && hintId ? hintId : undefined}
      >
        {children}
      </span>
    </div>
  );
}

/**
 * Инспектор полей сущности (референс ClickUp, грамматика «Инструмента»;
 * общий каркас — потребители: карточка задачи, письмо, паспорт проекта,
 * карточка сотрудника): чистые строки полей из реестра, видимость
 * настраивается кнопкой «+ Поле» с чекбоксами (persist localStorage).
 * Сетка на container queries зоны (@container у родителя): узко — 1 колонка,
 * широко — 2; зазор фикс, блок max-w-4xl центрируется (растут отступы).
 */
export function EntityFields({ defs, storageKey }: { defs: EntityFieldDef[]; storageKey: string }) {
  const { hiddenKeys, toggle } = useFieldVisibility(storageKey);
  const visible = defs.filter((d) => !hiddenKeys.includes(d.key));

  return (
    <div className="mx-auto mt-5 grid max-w-4xl grid-cols-1 gap-x-12 gap-y-0.5 @min-[55rem]:grid-cols-2">
      {visible.map((def) => (
        <FieldRow key={def.key} icon={def.icon} label={def.label} required={def.required}>
          {def.render()}
        </FieldRow>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground @min-[55rem]:col-span-2">
          <Plus className="size-3.5" strokeWidth={1.75} />
          {ui.common.addField}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {defs.map((def) => (
            <DropdownMenuCheckboxItem
              key={def.key}
              checked={!hiddenKeys.includes(def.key)}
              onCheckedChange={() => toggle(def.key)}
              onSelect={(e) => e.preventDefault()}
            >
              {def.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
