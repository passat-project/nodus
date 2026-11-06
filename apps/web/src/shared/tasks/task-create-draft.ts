import type {
  CreateTaskBody,
  CreationFieldKey,
  CreationForm,
  CustomFieldDefinition,
  RoleLabels,
  TaskListItem,
} from '@nodus/contracts';
import { missingCreateFields, slotLabel, withCreateBodyValue } from '@nodus/contracts';

import type { DraftChecklistItem } from './task-checklist-sheet.js';

/**
 * Черновик единого окна создания (#432, Р9): верх зафиксирован (название и
 * тип), низ — эффективная форма выбранного типа. Значения хранятся по КЛЮЧУ
 * слота (`description`, `assignee`, `cf.<id>`…), поэтому смена типа сохраняет
 * совместимые значения, а «не хватает» считается той же грамматикой, что на
 * сервере (`missingCreateFields`).
 */

/** Заполнение окна конкретным входом (плюсик колонки, подзадача, «В задачу»). */
export interface TaskCreatePrefill {
  typeId?: string;
  title?: string;
  description?: string;
  /** Ответственный из карточки сотрудника (он сам). */
  assigneeId?: string;
  parentId?: string;
  parentNumber?: number;
  /** Плюсик колонки «Моего плана»: после успеха вставить карточку в колонку. */
  personalStageId?: string;
  /** Плюсик доски проекта: стадия и проект. */
  stageId?: string;
  projectId?: string;
  /** «Задача» на узле дерева структуры (#467): узел подставлен пресетом;
   *  при обычном создании с проектом поле «Структура» спрашивает узел само. */
  nodeId?: string;
  /** «В задачу» из сообщения чата. */
  sourceMessageId?: string;
  /** Строка контекста окна («Подзадача к ПП-123», «Из сообщения»). */
  contextLabel?: string;
  onCreated?: (task: TaskListItem) => void;
}

export interface TaskCreateDraft {
  title: string;
  typeId: string | null;
  /** Значения по ключам слотов. */
  values: Record<string, unknown>;
  /** Узел структуры проекта (#467): обязателен при выборе проекта, у
   *  которого уже есть узлы; подзадача наследует узел родителя на сервере. */
  nodeId: string | null;
  /** Чип «Чек-лист»: пункты, введённые в окне. */
  checklist: DraftChecklistItem[];
  /** Чип «Планируемое время», минуты. */
  plannedMinutes: number | null;
}

/** Чистое окно: название и совместимые значения — из заполнения входа. */
export function emptyDraft(prefill: TaskCreatePrefill = {}): TaskCreateDraft {
  const values: Record<string, unknown> = {};
  if (prefill.description?.trim()) values.description = prefill.description;
  if (prefill.assigneeId) values.assignee = prefill.assigneeId;
  if (prefill.projectId) values.project = prefill.projectId;
  return {
    title: prefill.title ?? '',
    typeId: prefill.typeId ?? null,
    values,
    nodeId: prefill.nodeId ?? null,
    checklist: [],
    plannedMinutes: null,
  };
}

export function withTitle(draft: TaskCreateDraft, title: string): TaskCreateDraft {
  return { ...draft, title };
}

/** Смена типа НЕ стирает значения: они живут по ключу, а показываются только
 *  те, что есть в форме нового типа (Р9). */
export function withType(draft: TaskCreateDraft, typeId: string): TaskCreateDraft {
  return { ...draft, typeId };
}

export function withValue(
  draft: TaskCreateDraft,
  key: CreationFieldKey,
  value: unknown,
): TaskCreateDraft {
  const values = { ...draft.values };
  if (value === null || value === undefined || value === '') delete values[key];
  else values[key] = value;
  return { ...draft, values };
}

export function withNode(draft: TaskCreateDraft, nodeId: string | null): TaskCreateDraft {
  return { ...draft, nodeId };
}

/** Равенство значений черновика (примитивы/списки/деньги): префилл обновляет
 *  слот только пока человек его не тронул. */
export function sameDraftValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** Человеческая строка «Не хватает: …» (подписи слотов формы). */
export function missingTextOf(
  missing: readonly CreationFieldKey[],
  form: CreationForm,
  roleLabels: RoleLabels | undefined,
  definitions: readonly CustomFieldDefinition[],
): string {
  return missing
    .map((key) =>
      slotLabel(
        form.fields.find((slot) => slot.key === key) ?? {
          key,
          label: null,
          required: true,
          preset: null,
        },
        { roleLabels, definitions },
      ),
    )
    .join(', ');
}

export function withChecklist(
  draft: TaskCreateDraft,
  checklist: DraftChecklistItem[],
): TaskCreateDraft {
  return { ...draft, checklist };
}

export function withPlanned(
  draft: TaskCreateDraft,
  plannedMinutes: number | null,
): TaskCreateDraft {
  return { ...draft, plannedMinutes };
}

/** Тело из черновика: только значения слотов (ввод → поля API). */
export function draftBody(draft: TaskCreateDraft): CreateTaskBody {
  let body: CreateTaskBody = {
    title: draft.title.trim(),
    ...(draft.typeId ? { typeId: draft.typeId } : {}),
  };
  for (const [key, value] of Object.entries(draft.values)) {
    body = withCreateBodyValue(body, key as CreationFieldKey, value);
  }
  return body;
}

/** «Не хватает» для активной кнопки: обязательные поля формы без значения.
 *  Ответственного сервер ставит сам (постановщик) — он не в списке. */
export function missingFor(form: CreationForm, draft: TaskCreateDraft): CreationFieldKey[] {
  return missingCreateFields(form, draftBody(draft), { defaultsFilled: new Set(['assignee']) });
}

/** Итоговое тело: значения формы + заполнение входа (колонка, проект,
 *  родитель, источник) + чипы. Чипы шлют блоки, только если включены формой. */
export function buildCreateBody(
  draft: TaskCreateDraft,
  prefill: TaskCreatePrefill,
  form: CreationForm,
): CreateTaskBody {
  // Тело — только слоты АКТИВНОЙ формы: значение, оставшееся от прежнего типа,
  // не должно уезжать в customFields невидимо для человека (Р9).
  const allowed = new Set(form.fields.map((slot) => slot.key));
  const visibleValues = Object.fromEntries(
    Object.entries(draft.values).filter(([key]) => allowed.has(key as CreationFieldKey)),
  );
  const body = draftBody({ ...draft, values: visibleValues });
  const withPrefill: CreateTaskBody = {
    ...body,
    ...(prefill.personalStageId ? { personalStageId: prefill.personalStageId } : {}),
    ...(prefill.stageId ? { stageId: prefill.stageId } : {}),
    ...(prefill.parentId ? { parentId: prefill.parentId } : {}),
    ...(prefill.sourceMessageId ? { sourceMessageId: prefill.sourceMessageId } : {}),
    // Узел структуры: выбор в окне создания (если у проекта есть узлы) или
    // пресет «+ задача» на узле; подзадача наследует узел родителя сервером.
    ...((draft.nodeId ?? prefill.nodeId) ? { nodeId: draft.nodeId ?? prefill.nodeId } : {}),
    // Проект и ответственный из входа — если форма их не показала.
    ...(!body.projectId && prefill.projectId ? { projectId: prefill.projectId } : {}),
    ...(!body.assigneeId && prefill.assigneeId ? { assigneeId: prefill.assigneeId } : {}),
    ...(form.chips.includes('checklist') && draft.checklist.length > 0
      ? { checklist: draft.checklist.map((item) => item.text) }
      : {}),
    ...(form.chips.includes('planned') && draft.plannedMinutes
      ? { plannedMinutes: draft.plannedMinutes }
      : {}),
  };
  return withPrefill;
}
