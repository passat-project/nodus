import { X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@nodus/ui/components/sheet';
import { cn } from '@nodus/ui/lib/utils';

import { groupByModule, modulesWithChanges } from '../model/group-release.js';
import { RELEASES } from '../model/releases.js';
import { useWhatsNewStore } from '../model/whats-new-store.js';
import { ReleaseSection } from './release-section.js';

const MODULES = modulesWithChanges(RELEASES);

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-label font-medium transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'bg-muted/40 text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Панель «Что нового» (#386) — парящий лист справа (геометрия карточек-
 * слайдеров: отступ периметра 8px, радиус рамы, тень slider-shadow, БЕЗ
 * затемняющего задника — прозрачный click-catcher). Выпуски новые первыми,
 * пункты — по модулям рейки; чипы сверху фильтруют по модулю во всей
 * истории. Автопоказ фокус не крадёт (рабочее место остаётся как было),
 * открытие кнопкой — фокус в панель (канон диалогов).
 */
export function WhatsNewPanel() {
  const open = useWhatsNewStore((s) => s.open);
  const openReason = useWhatsNewStore((s) => s.openReason);
  const close = useWhatsNewStore((s) => s.close);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  if (RELEASES.length === 0) return null;

  const sections = RELEASES.map((release) => ({
    release,
    groups: groupByModule(release.items, moduleId),
  })).filter((s) => s.groups.length > 0);
  const [latest, ...earlier] = sections;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent
        ref={contentRef}
        side="right"
        showCloseButton={false}
        overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"
        onOpenAutoFocus={(event) => {
          if (openReason !== 'auto') return;
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        className={cn(
          'gap-0 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-(--slider-shadow) outline-none',
          'data-[side=right]:inset-y-2 data-[side=right]:right-2 data-[side=right]:h-auto data-[side=right]:w-[min(460px,calc(100vw-1rem))] data-[side=right]:border-l data-[side=right]:sm:max-w-none',
        )}
      >
        <header className="flex h-14 shrink-0 items-center gap-2 pr-3 pl-5">
          <SheetTitle className="min-w-0 flex-1 truncate text-lg font-semibold">
            {ui.whatsNew.title}
          </SheetTitle>
          <SheetDescription className="sr-only">{ui.whatsNew.description}</SheetDescription>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label={ui.common.close}>
              <X />
            </Button>
          </SheetClose>
        </header>

        {MODULES.length > 1 && (
          <div
            role="group"
            aria-label={ui.whatsNew.filterLabel}
            className="flex shrink-0 flex-wrap gap-1.5 px-5 pb-4"
          >
            <FilterChip active={moduleId === null} onClick={() => setModuleId(null)}>
              {ui.whatsNew.filterAll}
            </FilterChip>
            {MODULES.map((module) => {
              const Icon = module.icon;
              return (
                <FilterChip
                  key={module.id}
                  active={moduleId === module.id}
                  onClick={() => setModuleId(module.id)}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} />
                  {module.label}
                </FilterChip>
              );
            })}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          {!latest ? (
            <p className="py-10 text-center text-body-xs text-muted-foreground">
              {ui.whatsNew.emptyFilter}
            </p>
          ) : (
            <div className="flex flex-col gap-8">
              <ReleaseSection
                key={`${latest.release.version}:${moduleId ?? ''}`}
                release={latest.release}
                groups={latest.groups}
                // Первый ПОКАЗАННЫЙ выпуск всегда развёрнут: при фильтре по
                // модулю самый свежий выпуск может не иметь его изменений —
                // свёрнутая секция выглядела пустой панелью.
                collapsible={false}
              />
              {earlier.length > 0 && (
                <div className="flex flex-col gap-5">
                  <NodeLabel label={ui.whatsNew.earlier} />
                  {earlier.map(({ release, groups }) => (
                    <ReleaseSection
                      key={release.version}
                      release={release}
                      groups={groups}
                      collapsible
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
