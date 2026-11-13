import { Fragment } from 'react';
import type { WorkflowAction } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { ChevronDown, CircleSlash, Loader2, Zap } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { cn } from '@nodus/ui/lib/utils';

import { gateReasonsText } from '../api/transitions-api.js';

/** Сколько действий панель держит кнопкой без меню (#633, #707); от двух —
 *  сдвоенная кнопка (дефолт + меню), как и для действия с серверным
 *  `display: 'menu'`. Порог статический: коллективная кнопка перехода (#707)
 *  шире обычной, и два текстовых действия рядом с ней ломают строку бара. */
export const ACTIONS_INLINE_MAX = 1;

/** Общая часть кнопок панели: высота ряда, радиус, фокус-ринг канона. */
const triggerFocus =
  'outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30';

/**
 * Блок действий карточки (#633) — СДВОЕННАЯ кнопка, модель Битрикс24
 * (замечание Александра Климовича 13.11.2026):
 *
 *   [⚡ Название первого действия | ⌄ ]   ← одна кнопка из двух частей
 *    левая: выполнить                  правая: все действия
 *
 * Левая часть — обычная кнопка (`rounded-l-md`) с названием ПЕРВОГО действия
 * в порядке сервера: клик выполняет его сразу, без захода в список. Правая —
 * узкая (`w-7`, `rounded-r-md`) только с шевроном, открывает меню всех
 * действий. Разделитель между частями — `border-l border-border/60`; обе
 * `h-9`, у каждой свой фокус-ринг (не вложенные интерактивы — две отдельные
 * кнопки в `role="group"`).
 *
 * Особые случаи:
 * - первое действие помечено `display: 'menu'` — дефолтной кнопки нет, остаётся
 *   одиночная «Действия» с шевроном (настройку конструктора уважаем);
 * - одно действие — панель вообще не зовёт этот компонент (одиночная кнопка
 *   без шеврона, см. `TaskActionBar`);
 * - заблокированное дефолтное действие — левая часть не «мертвая»:
 *   `data-blocked` + `title` с причинами, клик идёт тем же путём, что и пункт
 *   меню (окно причин либо тост).
 *
 * Меню: шапка «Действия · N» (`DropdownMenuLabel`, не `menuitem`), пункты —
 * ОДНА строка (h-9, `px-2 py-1.5`), полные названия с `truncate` до 20rem,
 * иконка действия `size-4` того же оттенка, что у кнопки в панели.
 * Карандаша-маркера окна нет (владелец 13.11.2026: «для чего этот карандаш?»):
 * подсказка — в `title` самого пункта. У заблокированного — маркер
 * `CircleSlash` (`text-danger`) и полный список причин в `title`/`sr-only`;
 * клик по нему работает и открывает причины.
 * Разделитель — только на смене группы `display`, не между каждым пунктом.
 *
 * Ширина — ПО СОДЕРЖИМОМУ (`w-auto!` перебивает дефолт @nodus/ui, который
 * тянет ширину триггера): меню обтягивает самый длинный пункт, потолок
 * `max-w-[22rem]`, пол `min-w-44` при одном коротком пункте. Шеврон на ширину
 * не влияет — он вне содержимого.
 *
 * Шеврон — ОДИН (`ChevronDown`) и поворачивается на открытии
 * (`group-data-[state=open]/trigger:rotate-180`, стандарт поповеров): в покое
 * смотрит вниз («здесь раскроется меню»), при открытии — ВВЕРХ, куда меню и
 * растёт (`side="top"`); один значок вместо подмены компонентов не «прыгает».
 *
 * Клавиатура: Tab идёт по обеим частям, Enter на левой выполняет, на правой
 * открывает меню; Esc закрывает и возвращает фокус на правую (поведение Radix).
 */
export function TaskActionsMenu({
  actions,
  runningId,
  onRun,
}: {
  actions: readonly WorkflowAction[];
  runningId: string | null;
  onRun: (action: WorkflowAction) => void;
}) {
  const first = actions[0] ?? null;
  // Сдвоенная кнопка — когда дефолт есть (первое действие не «в меню»).
  const split = actions.length > ACTIONS_INLINE_MAX && first !== null && first.display !== 'menu';
  const reasonsOf = (action: WorkflowAction) =>
    `${ui.tasks.processBlockedMissing} ${gateReasonsText(action.blockedBy)}`;

  const menu = (
    <DropdownMenuContent align="end" side="top" className="w-auto! max-w-[22rem] min-w-44">
      <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
        {`${ui.tasks.actionsMenu} · ${actions.length}`}
      </DropdownMenuLabel>
      {actions.map((action, index) => {
        const blocked = action.blockedBy.length > 0;
        const running = runningId === action.id;
        const reasons = reasonsOf(action);
        // Разделитель — только на смене группы `display` (порядок внутри
        // группы — серверный); между соседними пунктами одной группы его нет.
        const groupBreak = index > 0 && actions[index - 1]?.display !== action.display;
        return (
          <Fragment key={action.id}>
            {groupBreak ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              // Как у кнопки действия: заблокированное видно, помечено и
              // объясняет причину; клик ведёт в окно причин.
              data-blocked={blocked || undefined}
              data-action-id={action.id}
              className="h-9 items-center gap-2 px-2 py-1.5"
              // Подсказка — на самом пункте: у заблокированного причина
              // важнее, у действия с окном — что оно окно и откроет.
              title={
                blocked
                  ? reasons
                  : action.form
                    ? `${action.name} — ${ui.tasks.actionOpensWindow}`
                    : action.name
              }
              onSelect={() => onRun(action)}
            >
              {running ? (
                <Loader2
                  className="size-4 shrink-0 animate-spin text-muted-foreground"
                  strokeWidth={1.75}
                />
              ) : (
                <Zap className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              )}
              <span
                className={cn('max-w-[20rem] min-w-0 truncate', blocked && 'text-muted-foreground')}
              >
                {action.name}
              </span>
              {blocked ? (
                <span className="ml-auto flex shrink-0 items-center pl-2">
                  <CircleSlash className="size-3.5 text-danger" strokeWidth={1.75} aria-hidden />
                  {/* Причина — текстом для скринридера (визуально — маркер). */}
                  <span className="sr-only">{reasons}</span>
                </span>
              ) : null}
            </DropdownMenuItem>
          </Fragment>
        );
      })}
    </DropdownMenuContent>
  );

  // «В меню» у первого действия: дефолтной кнопки нет, только «Действия ⌄».
  if (!split) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${ui.tasks.allActionsLabel} ${actions.length}`}
          title={ui.tasks.actionsMenu}
          className={cn(
            'group/trigger inline-flex h-9 min-w-0 items-center gap-2 rounded-md border border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors [flex-shrink:3]',
            'hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
            triggerFocus,
          )}
        >
          <Zap className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="whitespace-nowrap @max-[420px]:hidden">{ui.tasks.actionsMenu}</span>
          <ChevronDown
            className="size-3.5 shrink-0 opacity-70 transition-transform duration-150 group-data-[state=open]/trigger:rotate-180"
            strokeWidth={1.75}
          />
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    );
  }

  const defaultBlocked = (first?.blockedBy.length ?? 0) > 0;
  const defaultRunning = runningId === first?.id;
  return (
    <DropdownMenu>
      <div className="inline-flex items-stretch" role="group" aria-label={ui.tasks.actionsMenu}>
        {/* Левая часть — выполнить дефолтное (первое) действие сразу. */}
        <button
          type="button"
          aria-label={`${ui.tasks.actionRunLabel} ${first?.name ?? ''}`}
          aria-busy={defaultRunning || undefined}
          data-blocked={defaultBlocked || undefined}
          title={defaultBlocked ? reasonsOf(first as WorkflowAction) : first?.name}
          onClick={() => first && onRun(first)}
          className={cn(
            'inline-flex h-9 min-w-0 items-center gap-2 rounded-l-md border border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors [flex-shrink:3]',
            'hover:bg-accent hover:text-foreground',
            triggerFocus,
            defaultBlocked && 'opacity-50',
          )}
        >
          {defaultRunning ? (
            <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={1.75} />
          ) : (
            <Zap className="size-4 shrink-0" strokeWidth={1.75} />
          )}
          <span className="max-w-[14rem] min-w-0 truncate">{first?.name}</span>
        </button>
        {/* Правая часть — все действия; та же кнопка визуально, но своя. */}
        <DropdownMenuTrigger
          aria-label={`${ui.tasks.allActionsLabel} ${actions.length}`}
          title={ui.tasks.allActionsLabel}
          className={cn(
            'group/trigger inline-flex h-9 w-7 shrink-0 items-center justify-center rounded-r-md border border-l border-transparent border-l-border/60 text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
            triggerFocus,
          )}
        >
          <ChevronDown
            className="size-3.5 transition-transform duration-150 group-data-[state=open]/trigger:rotate-180"
            strokeWidth={1.75}
          />
        </DropdownMenuTrigger>
      </div>
      {menu}
    </DropdownMenu>
  );
}
