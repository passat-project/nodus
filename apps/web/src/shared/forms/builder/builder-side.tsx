import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import {
  AlignLeft,
  Calendar,
  Hash,
  ListFilter,
  Plus,
  SquareCheck,
  Type,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { fieldGroups, type FormBuilderHost, type PreviewKind } from './builder-host.js';
import { BuilderAlsoLocks } from './builder-locks.js';
import { availableOf, fieldCount, isBuilderBlock, type BuilderValue } from './builder-model.js';

const b = ui.forms.builder;

/** Значок строки палитры — вид контрола, который поле даст в окне. */
const PREVIEW_ICON: Record<PreviewKind, LucideIcon> = {
  input: Type,
  text: AlignLeft,
  select: ListFilter,
  people: Users,
  date: Calendar,
  number: Hash,
  toggle: SquareCheck,
};

/** Строка палитры (ревизия 27.11): элемент вертикального списка, как типы в
 *  окне атрибута, — значок контрола, название, тихий «+» справа; клик
 *  добавляет поле в конец окна. Прежние outline-кнопки-чипы «россыпью»
 *  ушли: в колонке слева список читается и не занимает пол-экрана. */
function PaletteRow({
  preview,
  label,
  title,
  disabled,
  onClick,
}: {
  preview: PreviewKind;
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = PREVIEW_ICON[preview] ?? Type;
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-secondary-foreground transition-colors hover:bg-accent/40 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Plus className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
    </button>
  );
}

/**
 * Палитра полей окна: «Добавить в окно» — поля, которых в окне нет (клик —
 * в конец окна), и «Блоки». Два вида: `chips` — лоток под листом в окне
 * перехода (как было, #496); `rows` — вертикальный список панели полей
 * справа во вкладке «Форма создания» (ревизия 27.11), грамматика списка
 * типов окна атрибута. `header` — собственная шапка секции; в панели её
 * рисует `BuilderRail` (шапка панели в грамматике панели узла).
 */
export function BuilderTray<X>({
  value,
  host,
  onChange,
  layout = 'chips',
  header = true,
}: {
  value: BuilderValue<X>;
  host: FormBuilderHost<X>;
  onChange: (next: BuilderValue<X>) => void;
  layout?: 'chips' | 'rows';
  header?: boolean;
}) {
  const rows = layout === 'rows';
  const full = fieldCount(value.items) >= host.limits.fields;
  const available = availableOf(host.catalog, value.items);
  const blocks = (host.blocks ?? []).filter(
    (option) => !value.items.some((item) => isBuilderBlock(item) && item.block === option.block),
  );
  // Системные поля и свои атрибуты — разными группами: настройщик видит, что
  // пришло с сущностью, а что создано в справочнике (#496, 08.11.2026).
  const groups = fieldGroups(available);
  return (
    <section
      className={rows ? 'flex flex-col gap-2' : 'flex flex-col gap-2 rounded-xl bg-muted/40 p-4'}
    >
      {header ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <h3 className="shrink-0 text-sm font-medium whitespace-nowrap">{b.tray}</h3>
          {host.onCreateField ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="ml-auto shrink-0"
              onClick={host.onCreateField}
            >
              <Plus className="size-3" strokeWidth={2} />
              {b.createField}
            </Button>
          ) : null}
        </div>
      ) : null}
      {available.length === 0 && blocks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{b.trayEmpty}</p>
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.label ?? 'fields'} className="flex flex-col gap-1.5">
              {/* Подпись группы — когда полей и блоков несколько категорий:
                  иначе лишний шум (вердикт владельца 08.11.2026). */}
              {group.label ? (
                <p className="text-label-sm text-muted-foreground">{group.label}</p>
              ) : null}
              {rows ? (
                <div className="flex flex-col gap-0.5">
                  {group.options.map((option) => (
                    <PaletteRow
                      key={option.key}
                      preview={host.info(option.key).preview}
                      label={option.label}
                      disabled={full}
                      title={full ? b.fieldsLimit : undefined}
                      onClick={() =>
                        onChange({ ...value, items: [...value.items, host.makeField(option.key)] })
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {group.options.map((option) => (
                    <Button
                      key={option.key}
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={full}
                      title={full ? b.fieldsLimit : undefined}
                      onClick={() =>
                        onChange({ ...value, items: [...value.items, host.makeField(option.key)] })
                      }
                    >
                      <Plus className="size-3" strokeWidth={2} />
                      {option.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {blocks.length > 0 && host.makeBlock ? (
            <div className="flex flex-col gap-1.5">
              {available.length > 0 ? (
                <p className="text-label-sm text-muted-foreground">{b.insertBlocks}</p>
              ) : null}
              {rows ? (
                <div className="flex flex-col gap-0.5">
                  {blocks.map((option) => (
                    <PaletteRow
                      key={option.block}
                      preview={option.preview}
                      label={option.label}
                      onClick={() =>
                        onChange({
                          ...value,
                          items: [...value.items, host.makeBlock!(option.block)],
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {blocks.map((option) => (
                    <Button
                      key={option.block}
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        onChange({
                          ...value,
                          items: [...value.items, host.makeBlock!(option.block)],
                        })
                      }
                    >
                      <Plus className="size-3" strokeWidth={2} />
                      {option.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Панель полей вкладки «Форма создания» (ревизия 27.11, второй заход —
 *  вердикт владельца: «справа как выдвижная панель, как панель настройки
 *  узла»). Грамматика `EditorPanel`: шапка `h-14` с подписью раздела и
 *  границей, прокручиваемое содержимое; сама панель — в `FormTabLayout`
 *  (фон `bg-card`, бордер слева, ширина 384). Внутри — палитра полей
 *  вертикальным списком и «Закрепить также» там, где у формы есть замки
 *  (тип задачи/письма); в просмотре добавлять нечего — остаются одни замки. */
export function BuilderRail<X>({
  value,
  host,
  readOnly,
  onChange,
}: {
  value: BuilderValue<X>;
  host: FormBuilderHost<X>;
  readOnly: boolean;
  onChange: (next: BuilderValue<X>) => void;
}) {
  return (
    <>
      {readOnly ? null : (
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <NodeLabel label={b.tray} />
          {host.onCreateField ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="ml-auto shrink-0"
              onClick={host.onCreateField}
            >
              <Plus className="size-3" strokeWidth={2} />
              {b.createField}
            </Button>
          ) : null}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
        {readOnly ? null : (
          <BuilderTray value={value} host={host} onChange={onChange} layout="rows" header={false} />
        )}
        {host.lockMode ? (
          <BuilderAlsoLocks value={value} host={host} readOnly={readOnly} onChange={onChange} />
        ) : null}
      </div>
    </>
  );
}
