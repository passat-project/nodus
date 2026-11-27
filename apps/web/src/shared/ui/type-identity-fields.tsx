import type { ReactNode } from 'react';
import { CommitInput } from './panel/commit-field.js';
import { PanelField } from './panel/panel-kit.js';
import { ColorSwatchRow } from './color-swatch-row.js';
import { IconPickPopover } from './icon-pick-popover.js';

/**
 * Поля идентичности типа — «Название», «Значок», «Цвет» — раздел «Основное»
 * окна настроек (ревизия UI v3, #857): одна группа на типы задачи, письма,
 * проекта и папки. Подписи НАД полями (окно атрибута), а не слева колонкой:
 * прежние строки «метка слева — контрол справа» съедали ширину и выдавливали
 * горизонтальный скролл. Поля занимают ВСЮ ширину формы окна (одна вертикаль
 * с «Описанием» и остальными разделами; свои max-w у полей убраны — название
 * и значок были уже описания), высота — калибр контролов `h-8`, как у полей
 * окна создания и строки поиска. Значок — кнопка-триггер с поповером, цвет —
 * ряд образцов; сохранение немедленное (по уходу фокуса / выбору). Строки
 * передают фичи-владельцы: примитив не знает, чей перед ним тип.
 */
export function TypeIdentityFields<T extends string, C extends string>({
  labels,
  name,
  icon,
  color,
  children,
}: {
  labels: { name: string; icon: string; color: string };
  name: { value: string; onChange: (next: string) => void; disabled?: boolean };
  icon: {
    value: T;
    options: readonly { value: T; label: string; title?: string; glyph: ReactNode }[];
    onChange: (next: T) => void;
    disabled?: boolean;
  };
  color: {
    value: C;
    options: readonly C[];
    swatchOf: (option: C) => string;
    nameOf: (option: C) => string;
    onChange: (next: C) => void;
    disabled?: boolean;
  };
  /** Дополнительные поля после цвета (описание типа). */
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PanelField label={labels.name}>
        <CommitInput
          value={name.value}
          required
          maxLength={60}
          disabled={name.disabled}
          aria-label={labels.name}
          className="h-8 w-full text-sm"
          onCommit={name.onChange}
        />
      </PanelField>
      <PanelField label={labels.icon}>
        <IconPickPopover
          value={icon.value}
          ariaLabel={labels.icon}
          options={icon.options}
          disabled={icon.disabled}
          onSelect={icon.onChange}
        />
      </PanelField>
      <PanelField label={labels.color}>
        <ColorSwatchRow
          ariaLabel={labels.color}
          value={color.value}
          options={color.options}
          swatchOf={color.swatchOf}
          nameOf={color.nameOf}
          disabled={color.disabled}
          onSelect={color.onChange}
        />
      </PanelField>
      {children}
    </div>
  );
}
