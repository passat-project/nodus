import type { ReactNode } from 'react';
import { Settings } from 'lucide-react';

import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';
import { CardTabStrip, type CardTabDef } from './entity-card/card-tab-strip.js';

/**
 * Рама карточки «Процессов» (#857) — одна на тип задачи, письмо, тип проекта,
 * тип папки и «Без проекта», и в рабочей области раздела, и в карточке стека:
 * верх — ЕДИНЫЙ бар, грамматика бара карточки проекта — слева добавлять,
 * справа завершать. Слева: полоса вкладок и сразу за ней инструменты
 * (`tools`) за волосяным разделителем; справа: `{status}{settingsAction}
 * {primaryAction}` — главная кнопка САМАЯ правая, разделителей между ними
 * нет. Крошек «‹ назад» рама не рисует: сущность открывается карточкой
 * поверх стека, а не переходом рамы «внутрь другого типа». Его нижняя
 * граница — та же линия, что под шапкой-поиском левой колонки (одна
 * горизонталь через весь экран, вертикальных швов между шапками нет).
 * Единая вертикаль слева: первый инструмент и первая вкладка стоят на одной
 * линии с содержимым тулбаров вкладок (`px-6`). Имя и значок типа справа НЕ
 * повторяются — они живут в строке списка слева и в заголовке карточки
 * стека.
 */

/** В баре уже 1120px (ниже полной ступени инструментов) у вкладки уходит
 *  иконка — название важнее: с иконками три-четыре вкладки рамы («Маршрут»,
 *  «Форма создания», «Где создаётся» / «Схема», «Что здесь можно создавать»,
 *  «Какие папки здесь бывают») не помещаются рядом с инструментами и
 *  действиями бара. На полной ступени иконка возвращается — вместе с
 *  подписью чипа проблем и полными подписями инструментов. */
function compactTab(tab: CardTabDef): CardTabDef {
  return tab.icon
    ? { ...tab, icon: <span className="flex @max-[1120px]:hidden">{tab.icon}</span> }
    : tab;
}

export function TypeCardFrame({
  tools,
  status,
  quiet,
  settingsAction,
  primaryAction,
  bar,
  tabs,
  activeTab,
  onActivateTab,
  idPrefix,
  tabsLabel,
  children,
}: {
  /** Инструменты добавления — сразу за вкладками, закреплены (тихие кнопки
   *  с подписью; в узком баре остаются иконки — `@max-[…]`, контейнер задаёт
   *  рама). При нехватке места скроллятся вкладки, не инструменты. */
  tools?: ReactNode;
  /** Состояние работы — первый в правом кластере (чип «Проблемы · N»). */
  status?: ReactNode;
  /** Тихое состояние и его действие («Сохранение…», «Не сохранилось» с
   *  «Повторить») — слева от шестерёнки, ВНЕ потока бара: появляясь, не
   *  отбирает место у вкладок (иначе они вздрагивали бы на каждом
   *  автосохранении). На узком баре ложится на хвост последней вкладки. */
  quiet?: ReactNode;
  /** Шестерёнка настроек сущности (`FrameSettingsButton`). */
  settingsAction?: ReactNode;
  /** Главная кнопка — самая правая («Опубликовать»). */
  primaryAction?: ReactNode;
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
  const cluster = status || quiet || settingsAction || primaryAction;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-stretch border-b border-border">
        {bar ? (
          <div className="@container flex min-w-0 flex-1 items-center pr-6 pl-6">{bar}</div>
        ) : tabs && tabs.length > 0 && activeTab && onActivateTab ? (
          // pl-3 + px-3 полосы = 24px: вкладки начинаются на вертикали
          // тулбаров вкладок; pr-2 + pr-2 слота = 16px справа.
          // Полоса — контейнерный контекст: в баре уже 1120px у вкладок уходят
          // иконки, инструменты переходят на короткие подписи без иконок, а уже
          // 730px остаются одними иконками — названия вкладок читаются, а не
          // обрезаются на первых буквах.
          <div className="@container min-w-0 flex-1 pr-2 pl-3">
            <CardTabStrip
              tall
              label={tabsLabel ?? ''}
              tabs={tabs.map(compactTab)}
              active={activeTab}
              idPrefix={idPrefix}
              onActivate={onActivateTab}
              // Инструменты закреплены за вкладками: при нехватке места
              // скроллятся вкладки, а «Добавить статус» не уезжает за край.
              // Разделитель живёт, пока у инструментов есть подписи.
              pinned={
                tools ? (
                  <div className="flex items-center">
                    <span
                      aria-hidden
                      className="mr-1.5 h-5 w-px shrink-0 bg-border @max-[800px]:mr-1 @max-[730px]:hidden"
                    />
                    {tools}
                  </div>
                ) : undefined
              }
              actions={
                cluster ? (
                  // Без инструментов слева (тип проекта, папка) кластер берёт
                  // воздух: при обрезанных вкладках шестерёнка не липнет к тексту.
                  <div
                    className={cn(
                      'relative flex items-center gap-1.5 @max-[800px]:gap-1',
                      !tools && 'pl-1.5',
                    )}
                  >
                    {quiet ? (
                      <div className="pointer-events-none absolute top-1/2 right-full mr-1.5 -translate-y-1/2 rounded-lg bg-card pl-3 [mask-image:linear-gradient(to_right,transparent,black_12px)] [&>*]:pointer-events-auto">
                        {quiet}
                      </div>
                    ) : null}
                    {status}
                    {settingsAction}
                    {primaryAction}
                  </div>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** Шестерёнка настроек типа в баре рамы — один калибр на все виды типа. */
export function FrameSettingsButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="text-muted-foreground"
    >
      <Settings className="size-4" strokeWidth={1.75} />
    </Button>
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
