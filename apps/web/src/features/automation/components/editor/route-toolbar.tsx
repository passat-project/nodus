import type { ProcessType, WorkflowProblem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { ArrowRightLeft, LayoutGrid, Plus } from 'lucide-react';

import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { ProblemsChip } from './problems-chip.js';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Верхний бар окна редактора (#378 ред. 2) — как бар беседы мессенджера:
 * h-14 с линией border-b (её продолжают шапка списка типов слева и шапка
 * правой панели справа). Слева — тип и состояние (черновик / опубликовано,
 * проблемы), затем «+ Статус», «+ Переход», «Упорядочить» (как в Трекере);
 * справа — «Сбросить» и «Опубликовать». Масштаб и отмена — на холсте слева
 * внизу. Бар живёт в колонке холста и сужается вместе с ней, когда выезжает
 * панель: подписи действий прячутся (контейнерные брейкпоинты), левая часть
 * обрезается — «Опубликовать» не уезжает никогда.
 *
 * #497: в узком холсте (открыта правая панель) подписи скрыты, поэтому каждое
 * действие обязано отличаться ИКОНКОЙ и иметь aria-label: два одинаковых «+»
 * неразличимы. Лестница приоритетов при сужении (каждый шаг — когда места
 * реально не хватает, а не «на всякий случай»): 930 — подпись «Упорядочить» и
 * чип даты публикации (его полный вид — в title): имя типа — главный элемент
 * бара и не должно резаться до «Ст…» на 1920 с открытой панелью (~766px);
 * 880 — подписи всех действий и разделитель; 640 — чип проблем сжимается до
 * иконки со счётчиком; 560 — счётчик чипа тоже уходит (имя и число — в
 * title/aria-label), отступы сжимаются, «Сбросить» уходит из бара целиком
 * (он продублирован в баннере черновика над холстом): всё это освобождает
 * место имени типа;
 * 400 — имя типа уходит в глиф (текст остаётся в дереве доступности через
 * sr-only); 340 — при проблемах уходит и глиф (состояние важнее идентичности:
 * тип виден в списке слева), «Упорядочить» скрывается;
 * 200 — в баре остаётся только публикация (холст такой ширины нередактируем)
 * и сжимаются отступы, чтобы кнопка не выезжала поверх шапки правой панели.
 * Итог: на ~286px (узкое окно с открытой панелью) бар —
 * «проблемы · + · ⇄ · Опубликовать» без обрезки.
 *
 * Контейнер — обёртка, а не сам <header>: правила @container применяются только
 * к потомкам контейнера, на нём самом они мертвы (поэтому padding бара
 * сокращается на @max-[200px] уже внутри обёртки).
 */
export function RouteToolbar({
  type,
  canManage,
  dirty,
  publishedAt,
  publishedBy,
  problems,
  publishBlocked,
  addTransition,
  onAddStage,
  onTidy,
  onProblemClick,
  onDiscard,
  onPublish,
}: {
  type: ProcessType;
  canManage: boolean;
  dirty: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  problems: readonly WorkflowProblem[];
  publishBlocked: boolean;
  /** Кнопка-поповер «+ Переход»: тулбар рисует кнопку, хост оборачивает её поповером. */
  addTransition: (trigger: React.ReactNode) => React.ReactNode;
  onAddStage: () => void;
  onTidy: () => void;
  onProblemClick: (problem: WorkflowProblem) => void;
  onDiscard: () => void;
  onPublish: () => void;
}) {
  const errors = problems.filter((p) => p.severity === 'error').length;
  return (
    <div className="@container w-full shrink-0">
      <header
        // nokey: клавиши на кнопках строки не удаляют выделенное на холсте.
        className="nokey flex h-14 items-center gap-2 overflow-hidden border-b border-border px-4 @max-[760px]:px-3 @max-[200px]:px-1"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden @max-[760px]:gap-1.5 @max-[560px]:gap-1 @max-[200px]:hidden">
          <span
            className={`flex min-w-0 shrink items-center gap-2 ${problems.length > 0 ? '@max-[340px]:hidden' : ''}`}
            title={type.name}
          >
            <ProcessTypeGlyph icon={type.icon} className="size-4 shrink-0 text-muted-foreground" />
            <span aria-hidden className="truncate text-sm font-medium @max-[400px]:hidden">
              {type.name}
            </span>
          </span>
          {!canManage ? (
            <span className="shrink-0 rounded-full border border-border bg-accent/40 px-2.5 py-1 text-xs text-muted-foreground">
              {ui.automation.readOnly}
            </span>
          ) : dirty ? (
            <span className="shrink-0 truncate rounded-full border border-warning/40 bg-warning-soft/60 px-2.5 py-1 text-xs text-warning @max-[640px]:hidden">
              {ui.automation.chipDraft}
            </span>
          ) : publishedAt ? (
            <span
              className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums @max-[930px]:hidden"
              title={`${ui.automation.chipPublishedAt} ${formatDate(publishedAt)}${publishedBy ? ` · ${publishedBy}` : ''}`}
            >
              {formatDate(publishedAt)}
            </span>
          ) : null}
          {problems.length > 0 ? (
            <div className="flex shrink-0">
              <ProblemsChip problems={problems} onProblemClick={onProblemClick} />
            </div>
          ) : null}
          {canManage ? (
            <>
              <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border @max-[880px]:hidden" />
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 @max-[880px]:px-1.5"
                onClick={onAddStage}
                title={ui.automation.addStage}
                aria-label={ui.automation.addStage}
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
                <span className="@max-[880px]:hidden">{ui.automation.addStage}</span>
              </Button>
              {addTransition(
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 @max-[880px]:px-1.5"
                  title={ui.automation.addTransitionLabel}
                  aria-label={ui.automation.addTransitionLabel}
                >
                  <ArrowRightLeft className="size-3.5" strokeWidth={1.75} />
                  <span className="@max-[880px]:hidden">{ui.automation.addTransitionLabel}</span>
                </Button>,
              )}
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 @max-[880px]:px-1.5 @max-[340px]:hidden"
                onClick={onTidy}
                title={ui.automation.tidyUp}
                aria-label={ui.automation.tidyUp}
              >
                <LayoutGrid className="size-3.5" strokeWidth={1.75} />
                <span className="@max-[930px]:hidden">{ui.automation.tidyUp}</span>
              </Button>
            </>
          ) : null}
        </div>
        {/* Имя типа живёт в дереве доступности всегда: на узком холсте текст
            прячется визуально, при проблемах скрывается и глиф, а на ≤200px —
            вся левая группа; поэтому копия — прямой потомок бара. */}
        <span className="sr-only">{type.name}</span>
        {canManage ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {dirty ? (
              <Button
                variant="ghost"
                size="sm"
                // ≤560 «Сбросить» уходит из бара: он дублирован кнопкой
                // в баннере черновика над холстом, а место нужно имени типа.
                className="@max-[560px]:hidden"
                onClick={onDiscard}
                title={ui.automation.discardShort}
                aria-label={ui.automation.discardShort}
              >
                {ui.automation.discardShort}
              </Button>
            ) : null}
            <Button
              size="sm"
              className="@max-[340px]:px-2 @max-[200px]:px-1.5"
              disabled={publishBlocked || errors > 0}
              title={errors > 0 ? `${ui.automation.problemsFixFirst} ${errors}` : undefined}
              onClick={onPublish}
            >
              {ui.automation.publish}
            </Button>
          </div>
        ) : null}
      </header>
    </div>
  );
}
