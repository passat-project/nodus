import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

import { cn } from '@nodus/ui/lib/utils';
import { CardTabStrip, type CardTabDef } from './entity-card/card-tab-strip.js';

/**
 * Рама карточки «Процессов» (#857) — одна на тип задачи, письмо, тип проекта,
 * тип папки и «Без проекта» (финальный концепт владельца 26.11.2026):
 * верх — ЕДИНЫЙ бар: полоса вкладок и действия активной вкладки справа;
 * его нижняя граница — та же линия, что под шапкой-поиском левой колонки
 * (одна горизонталь через весь экран, вертикальных швов между шапками нет).
 * Имя и значок выбранного типа справа НЕ повторяются — они живут только в
 * строке списка слева; под баром — тонкая строка: крошка «‹ Договор» (только
 * при входе из другого типа) и подсказка «Используется в: …». Содержимое
 * вкладки начинается сразу под строкой.
 */
export function TypeCardFrame({
  backLabel,
  onBack,
  meta,
  actions,
  settingsAction,
  bar,
  tabs,
  activeTab,
  onActivateTab,
  idPrefix,
  tabsLabel,
  children,
}: {
  /** Имя типа проекта, из которого открыта карточка (крошка «‹ Договор»). */
  backLabel?: string;
  onBack?: () => void;
  /** Подсказка места типа: «Используется в: …» (тихая строка под баром). */
  meta?: ReactNode;
  /** Действия активной вкладки — в правой части единого бара. */
  actions?: ReactNode;
  /** Кнопка настроек сущности — самый правый угол бара (есть у всех типов). */
  settingsAction?: ReactNode;
  /** Содержимое бара у поверхности БЕЗ вкладок («Без проекта»): тулбар списка. */
  bar?: ReactNode;
  tabs?: CardTabDef[];
  activeTab?: string;
  onActivateTab?: (id: string) => void;
  idPrefix?: string;
  /** Доступное имя полосы вкладок (у поверхности без вкладок не нужно). */
  tabsLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-stretch border-b border-border pr-3">
        {bar ? (
          <div className="flex min-w-0 flex-1 items-center pl-6">{bar}</div>
        ) : tabs && tabs.length > 0 && activeTab && onActivateTab ? (
          <div className="min-w-0 flex-1">
            <CardTabStrip
              tall
              label={tabsLabel ?? ''}
              tabs={tabs}
              active={activeTab}
              idPrefix={idPrefix}
              onActivate={onActivateTab}
              actions={
                actions || settingsAction ? (
                  <div className="flex items-center gap-1.5">
                    {actions}
                    {settingsAction && actions ? (
                      <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
                    ) : null}
                    {settingsAction}
                  </div>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
      </div>
      {backLabel || meta ? (
        <div className="flex shrink-0 items-center gap-2 px-6 pt-1.5 pb-0.5 text-label-sm text-muted-foreground">
          {backLabel && onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring/70"
            >
              <ChevronLeft className="size-3.5" strokeWidth={1.75} />
              {backLabel}
            </button>
          ) : null}
          {backLabel && meta ? <span aria-hidden>·</span> : null}
          {meta ? <span className="min-w-0 truncate">{meta}</span> : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** Панель вкладки: монтируется только активной, заполняет высоту рамы. */
export function TypeCardPanel({
  idPrefix,
  tab,
  children,
  className,
}: {
  idPrefix: string;
  tab: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-${tab.replace(':', '-')}-panel`}
      aria-labelledby={`${idPrefix}-${tab.replace(':', '-')}-tab`}
      className={cn('flex h-full min-h-0 flex-col', className)}
    >
      {children}
    </div>
  );
}
