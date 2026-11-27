import type { WorkflowProblem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { createPortal } from 'react-dom';

import { ProblemsChip } from './problems-chip.js';

/** Три места единого бара рамы, куда редактор порталит свои группы (#857). */
export interface RouteBarHosts {
  /** Инструменты добавления — сразу за вкладками. */
  tools: HTMLElement | null;
  /** Состояние работы — чип проблем. */
  status: HTMLElement | null;
  /** Главная кнопка — «Опубликовать», крайняя справа. */
  primary: HTMLElement | null;
}

/**
 * Кусочки редактора маршрута для ЕДИНОГО бара рамы (ревизия UI v3, #857):
 * бар — грамматика «слева добавлять, справа завершать», поэтому редактор
 * порталит в раму три группы — инструменты за вкладками, состояние и главную
 * кнопку. Просмотр (письма, нет права) действий не предлагает: остаются
 * только чип проблем. «Сбросить» живёт в плашке черновика на холсте,
 * «Упорядочить» — в наклонном стеку холста; здесь им не место.
 */

/** Ступени ширины бара — литералами (сканер Tailwind не соберёт класс из
 *  конкатенации), контейнер задаёт рама. От 1120px — «+ Добавить статус»,
 *  «+ Добавить переход» с подписью. Ниже — только знаки: «+» и «⇄».
 *  Короткие подписи «Статус»/«Переход» без знака отвергнуты (владелец:
 *  читались ещё двумя вкладками), а знак с подписью на рабочей ширине
 *  владельца (1536 → рама 766px) не влезает: у рамы типа с тремя вкладками
 *  и чипом проблем запас был ровно 0 — «+ Статус ⇄ Переход» отрезали третью
 *  вкладку («Где созда…»). Знаки в баре читаются действием (тулбар-модель),
 *  полные имена — `title` и `aria-label` на всех ступенях.
 *
 *  Условия ступеней не пересекаются, поэтому порядок правил в CSS не важен. */
const TOOL_CLASS = 'gap-1 pr-1.5 @min-[1120px]:pr-2 @max-[1120px]:px-2';
/** Полная подпись — только на широкой ступени. */
const FULL_LABEL = 'hidden @min-[1120px]:inline';
/** Иконка рядом с полной подписью — только на широкой ступени. */
const FULL_ICON = 'hidden @min-[1120px]:block';
/** Знак действия — на всех ступенях ниже полной. Кегль 14px: иконка по
 *  умолчанию (20px) раздувала icon-кнопку бара, а на рабочей ширине
 *  владельца место у вкладок на счету. */
const ACTION_ICON = 'size-3.5 block @min-[1120px]:hidden';

/**
 * Инструмент бара — тихая кнопка «иконка + подпись», один калибр с главной
 * кнопкой. Поповер «Добавить переход» сам владеет кнопкой (Radix Trigger),
 * поэтому кнопку рисует эта функция, а `onClick` приходит снаружи.
 */
function toolButton({
  label,
  icons,
  props = {},
}: {
  /** Полное название — доступное имя и `title` на всех ступенях. */
  label: string;
  /** Иконка узкой ступени (без подписи) и — если своя — иконка широкой. */
  icons: { alone: React.ReactNode; withFull?: React.ReactNode };
  props?: { onClick?: () => void };
}) {
  return (
    <Button variant="ghost" aria-label={label} title={label} className={TOOL_CLASS} {...props}>
      {icons.alone}
      {icons.withFull}
      <span className={FULL_LABEL}>{label}</span>
    </Button>
  );
}

/** Инструменты добавления — сразу за вкладками; только с правом управления. */
function RouteBarTools({
  onAddStage,
  addTransition,
}: {
  onAddStage: () => void;
  /** Кнопка-поповер «Добавить переход»: бар рисует кнопку, редактор оборачивает. */
  addTransition: (trigger: React.ReactNode) => React.ReactNode;
}) {
  return (
    <>
      {toolButton({
        label: ui.automation.addStage,
        icons: {
          alone: <Plus className={ACTION_ICON} />,
          withFull: <Plus data-icon="inline-start" className={FULL_ICON} />,
        },
        props: { onClick: onAddStage },
      })}
      {addTransition(
        toolButton({
          label: ui.automation.addTransitionLabel,
          // Знак отличает инструменты: «+» — новый статус, «⇄» — переход.
          icons: {
            alone: <ArrowRightLeft className={ACTION_ICON} />,
            withFull: <Plus data-icon="inline-start" className={FULL_ICON} />,
          },
        }),
      )}
    </>
  );
}

/** Три группы бара рамы — порталом в хосты, которые рама выделила под редактор
 *  (на вкладке не «Маршрут» и у приостановленной рамы хостов нет). */
export function RouteBarPortals({
  hosts,
  canManage,
  dirty,
  problems,
  onAddStage,
  addTransition,
  onProblemClick,
  onPublish,
}: {
  hosts: RouteBarHosts | null | undefined;
  canManage: boolean;
  dirty: boolean;
  problems: readonly WorkflowProblem[];
  onAddStage: () => void;
  addTransition: (trigger: React.ReactNode) => React.ReactNode;
  onProblemClick: (problem: WorkflowProblem) => void;
  onPublish: () => void;
}) {
  if (!hosts) return null;
  const errors = problems.filter((p) => p.severity === 'error').length;
  return (
    <>
      {hosts.tools && canManage
        ? createPortal(
            <RouteBarTools onAddStage={onAddStage} addTransition={addTransition} />,
            hosts.tools,
          )
        : null}
      {/* Чип проблем — и в просмотре: заблокированная публикация без
          объяснения хуже; только когда проблемы есть. */}
      {hosts.status && problems.length > 0
        ? createPortal(
            <ProblemsChip problems={problems} onProblemClick={onProblemClick} />,
            hosts.status,
          )
        : null}
      {hosts.primary && canManage
        ? createPortal(
            <Button
              size="default"
              disabled={!dirty || errors > 0}
              title={errors > 0 ? `${ui.automation.problemsFixFirst} ${errors}` : undefined}
              onClick={onPublish}
            >
              {ui.automation.publish}
            </Button>,
            hosts.primary,
          )
        : null}
    </>
  );
}
