import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

/** Раздел окна настроек: строка навигации слева (иконка + название). */
export interface SettingsSplitSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Каркас окна настроек типа (ревизия UI v3, #857) — грамматика окна атрибута
 * (`FieldDialog`): слева узкая навигация по разделам, справа — содержимое
 * ОДНОГО активного раздела (остальные не смонтированы: окно больше не
 * «простыня» с общим вертикальным скроллом). Классы строк и списка — один в
 * один с `FieldTypePicker`: активная — ступень `bg-accent`, прочие —
 * `text-secondary-foreground`. Сохранение остаётся немедленным — поэтому
 * футер без «Сохранить»: слева опасное действие, справа «Закрыть»; мимо-клик
 * окно не закрывает. Высота — как у окна атрибута: не ниже `min(34rem,88vh)`,
 * правая колонка скроллится, горизонтальной полосы нет (`overflow-x-hidden`).
 *
 * Ширина окна — `48rem`: после вычета навигации, зазора и отступов форма
 * (одна колонка раздела) занимает ~600px. Это единая ширина формы окна —
 * поля, ряды тумблеров, карточки выбора и триггеры встают на одну правую
 * вертикаль (раньше у каждого раздела была своя: 560/480/775). Ритм между
 * блоками раздела — `gap-5`, внутри блока — свой `gap-4`: подпись группы не
 * липнет к предыдущей карточке, а подсказка под последней отделена воздухом
 * (было 0px между полями блока — «Роли» шли сплошной простынёй).
 */
export function SettingsSplitDialog({
  title,
  sectionsLabel,
  sections,
  active,
  onActivate,
  danger,
  onClose,
  children,
}: {
  title: ReactNode;
  /** Доступное имя навигации и подпись её заголовка. */
  sectionsLabel: string;
  sections: readonly SettingsSplitSection[];
  active: string;
  onActivate: (id: string) => void;
  /** Опасное действие внизу слева (архив / возврат из архива). */
  danger?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="flex max-h-[92vh] min-h-[min(34rem,88vh)] max-w-[48rem] flex-col gap-5 overflow-hidden p-5 sm:max-w-[48rem]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-6">
          <aside className="flex w-52 shrink-0 flex-col gap-2">
            <NodeLabel label={sectionsLabel} />
            <div
              role="tablist"
              aria-orientation="vertical"
              aria-label={sectionsLabel}
              className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1"
            >
              {sections.map((section) => {
                const Icon = section.icon;
                const selected = section.id === active;
                return (
                  <button
                    key={section.id}
                    type="button"
                    role="tab"
                    id={`${id}-${section.id}-tab`}
                    aria-selected={selected}
                    aria-controls={`${id}-${section.id}-panel`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => onActivate(section.id)}
                    onKeyDown={(event) => {
                      // ↑/↓ — соседний раздел (вертикальный список — как
                      // радиогруппа окна атрибута), Home/End — края.
                      const index = sections.findIndex((entry) => entry.id === section.id);
                      const target =
                        event.key === 'ArrowDown'
                          ? sections[(index + 1) % sections.length]
                          : event.key === 'ArrowUp'
                            ? sections[(index - 1 + sections.length) % sections.length]
                            : event.key === 'Home'
                              ? sections[0]
                              : event.key === 'End'
                                ? sections.at(-1)
                                : undefined;
                      if (!target) return;
                      event.preventDefault();
                      onActivate(target.id);
                      document.getElementById(`${id}-${target.id}-tab`)?.focus();
                    }}
                    className={cn(
                      'flex w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/70',
                      selected
                        ? 'bg-accent text-foreground'
                        : 'text-secondary-foreground hover:bg-accent/40',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        selected ? 'text-foreground' : 'text-muted-foreground',
                      )}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className="min-w-0 truncate">{section.label}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* overflow-x-hidden: иначе вертикальная прокрутка включает
              горизонтальную полосу от долей пикселя (как в окне атрибута).
              Запас p-1.5 с компенсацией -m-1.5: кольцо выбранного образца
              цвета (4px вне кружка) попадает в padding-бокс и не режется
              кромкой скроллера, а содержимое остаётся на прежних местах. */}
          <div
            role="tabpanel"
            id={`${id}-${active}-panel`}
            aria-labelledby={`${id}-${active}-tab`}
            className="-m-1.5 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-1.5"
          >
            <div className="flex min-w-0 flex-col gap-5">{children}</div>
          </div>
        </div>

        <DialogFooter className="shrink-0 items-center">
          {danger ? <div className="mr-auto">{danger}</div> : null}
          <Button variant="ghost" onClick={onClose}>
            {ui.common.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
