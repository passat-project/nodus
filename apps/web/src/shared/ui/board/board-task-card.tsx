import { CornerDownRight, Mail, MessageSquare } from 'lucide-react';
import { memo, useMemo } from 'react';
import type { TaskListItem } from '@nodus/contracts';
import { isCustomFieldValueFilled, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { formatMinutes } from '../../lib/format.js';
import { useCommentsCount } from '../../tasks/comments-live.js';
import {
  attributeFormula,
  attributeRefs,
  attributeRenderCell,
  attributeValue,
} from '../../views/attribute-fields.js';
import type { FieldDef } from '../../views/use-view-fields.js';
import { PersonAvatar } from '../person-avatar.js';
import { DeadlineChip } from '../deadline-chip.js';
import { identityTone } from '../identity-tone.js';
import { ProcessTypeGlyph } from '../../workflow/process-type-icon.js';
import { stageTone } from './stage-tone.js';

/** Карточка задачи канбан-доски (общая оболочка борда, второй потребитель —
 *  проектная доска): node-панель; отображаемые поля настраиваются шестерёнкой
 *  вида — карточка получает предикат видимости из реестра потребителя.
 *  Презентационная: открытие (клик, rect источника для shared-element) и
 *  префетч подключает фича через onOpen/onHover.
 *  overlay — призрак DragOverlay во время переноса (активный узел: свечение).
 *  placeholder — слот переносимой карточки (пунктир, без свечения).
 *  fields — реестр вида: блоки с определением атрибута (#632) рисуются
 *  значением по грамматике типа; пустое значение блок не показывает. */
function BoardTaskCardInner({
  task,
  parentNumber,
  isVisible,
  fields,
  overlay = false,
  placeholder = false,
  onOpen,
  onHover,
}: {
  task: TaskListItem;
  parentNumber?: number;
  isVisible: (fieldId: string) => boolean;
  /** Реестр полей вида — источник атрибутных блоков (необязателен). */
  fields?: readonly FieldDef[];
  overlay?: boolean;
  placeholder?: boolean;
  /** Клик по карточке: фича решает, куда открыть (слайдер) и прокидывает rect. */
  onOpen: (task: TaskListItem, rect: DOMRect) => void;
  /** Ховер: префетч детали/обсуждения (опционально). */
  onHover?: (task: TaskListItem) => void;
}) {
  const showFooter = isVisible('assignee') || isVisible('comments') || isVisible('spent');
  // Живой счётчик (#252): +1 сразу по сообщению, точное значение — событием.
  const commentsCount = useCommentsCount(task);
  // Атрибуты карточки (#632): включённые шестерёнкой и непустые.
  const attributes = (fields ?? []).filter(
    (field) => field.attribute !== undefined && isVisible(field.id),
  );
  const refs = useMemo(() => attributeRefs(task), [task]);

  return (
    <button
      type="button"
      onPointerEnter={() => onHover?.(task)}
      onClick={(e) => onOpen(task, e.currentTarget.getBoundingClientRect())}
      className={cn(
        'node-panel relative flex w-full flex-col gap-2 overflow-hidden p-3 text-left transition-colors hover:border-input',
        overlay && 'cursor-grabbing border-input shadow-[0_0_12px_var(--glow)] hover:border-input',
        placeholder && 'border-dashed opacity-60 hover:border-input',
      )}
    >
      {isVisible('type') ? (
        /* 4px literal (как мини-бейджи): 0.125rem = 2.5px — дробная толщина
           на полу-пиксельных позициях карточек растриризуется то в 3, то в 4
           физических пикселя (масштаб 125%), полоса «прыгает» по толщине;
           4px цел на 100/125/150/200% (§403, замечание владельца 04.11). */
        <span
          aria-hidden
          className={cn('absolute inset-x-0 top-0 h-[4px]', stageTone[task.type.color].dot)}
        />
      ) : null}
      {isVisible('parent') && parentNumber !== undefined ? (
        <span className="flex items-center gap-1.5 text-label-sm font-medium tracking-wide text-muted-foreground uppercase">
          <CornerDownRight className="size-3" />
          {ui.tasks.subtaskOf} · {parentNumber}
        </span>
      ) : null}
      {isVisible('number') || isVisible('source') || isVisible('type') ? (
        <span className="flex items-center justify-between gap-2">
          {isVisible('number') ? (
            <span className="font-mono text-label-sm text-muted-foreground tabular-nums">
              № {task.number}
            </span>
          ) : (
            <span />
          )}
          {/* Приметы карточки — одним кластером справа: тип (значок, название
              по наведению) и источник. Отдельной строкой значок типа читался
              чекбоксом-контролом и зря съедал строку; в левом верхнем углу
              карточки он спорил с местом отметки о выполнении (§403). */}
          <span className="flex shrink-0 items-center gap-1.5">
            {isVisible('type') ? (
              <span
                role="img"
                className="flex items-center text-muted-foreground"
                title={task.type.name}
                aria-label={task.type.name}
              >
                <ProcessTypeGlyph icon={task.type.icon} className="size-3.5 shrink-0" />
              </span>
            ) : null}
            {isVisible('source') && task.source === 'letter' ? (
              <Mail className="size-3.5 text-info/70" aria-label={ui.tasks.fromLetter} />
            ) : null}
            {isVisible('source') && task.source === 'chat_message' ? (
              <MessageSquare className="size-3.5 text-info/70" aria-label={ui.tasks.fromChat} />
            ) : null}
          </span>
        </span>
      ) : null}
      <span className="line-clamp-2 text-sm font-medium">{task.title}</span>
      {isVisible('deadline') ? (
        <DeadlineChip deadline={task.deadline} state={task.stage.systemState} />
      ) : null}
      {isVisible('project') && task.project ? (
        <span className="flex min-w-0 items-center gap-1.5 text-body-xs text-info/80">
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${identityTone[task.project.color].dot}`}
          />
          <span className="truncate">{task.project.name}</span>
        </span>
      ) : null}
      {/* Атрибуты (#632): «Название: значение» одной строкой; значение —
          компактно и без ссылок (карточка — кнопка: вложенные кнопки и <a>
          запрещены), длинный текст обрезается многоточием. */}
      {attributes.map((field) => {
        const definition = field.attribute;
        if (!definition) return null;
        const value = attributeValue(task, definition);
        const formula = attributeFormula(task, definition);
        // Ошибка формулы видна и без значения (бейдж «!»).
        if (!isCustomFieldValueFilled(value) && !formula?.error) return null;
        return (
          <span
            key={field.id}
            data-card-field={field.id}
            className="flex min-w-0 items-baseline gap-1.5 text-body-xs"
          >
            <span className="shrink-0 text-muted-foreground">{field.label}</span>
            <span className="min-w-0 text-foreground/90 line-clamp-1">
              {attributeRenderCell(definition, value, refs, {
                interactive: false,
                formula,
              })}
            </span>
          </span>
        );
      })}
      {showFooter ? (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {isVisible('assignee') && task.assignee ? (
            <PersonAvatar
              name={task.assignee.displayName}
              avatarUrl={task.assignee.avatarUrl}
              decorative
              className="size-6"
            />
          ) : null}
          {isVisible('comments') ? (
            <span className="ml-auto inline-flex items-center gap-1 font-mono text-label-sm tabular-nums">
              <MessageSquare className="size-3.5" />
              {commentsCount}
            </span>
          ) : (
            <span className="ml-auto" />
          )}
          {isVisible('spent') && task.spentMinutes > 0 ? (
            <span className="font-mono text-label-sm tabular-nums">
              {formatMinutes(task.spentMinutes)}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/**
 * memo карточки канбана (A6-4, #632): рендер борда (смена состава колонок,
 * drag-состояние, фильтр) перерисовывал ВСЕ карточки, хотя менялись единицы.
 * `onOpen`/`onHover` в сравнении не участвуют: потребители передают стрелки
 * заново на каждый свой рендер, а внутри — стабильные хуки (`useOpenCard`,
 * `usePrefetchTask`); обработчик вызывается только из события, поэтому
 * «протухшая» ссылка ведёт себя ровно так же.
 */
export const BoardTaskCard = memo(
  BoardTaskCardInner,
  (prev, next) =>
    prev.task === next.task &&
    prev.parentNumber === next.parentNumber &&
    prev.isVisible === next.isVisible &&
    prev.fields === next.fields &&
    prev.overlay === next.overlay &&
    prev.placeholder === next.placeholder,
);
