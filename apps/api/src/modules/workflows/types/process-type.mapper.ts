import type {
  LetterDirection,
  ProcessCategory,
  ProcessType,
  ProcessTypeIcon,
  StageColor,
} from '@nodus/contracts';
import {
  effectiveCreationForm,
  normalizeTypeConfig,
  typeAccessFor,
  type CreationForm,
  type TypeAccessSubject,
  isCreationSlot,
} from '@nodus/contracts';

/** Строка `process_types` в объёме DTO (поля — ADR-0024, #378/#432). */
export interface ProcessTypeRow {
  id: string;
  code: string;
  name: string;
  category: string;
  direction: string | null;
  icon: string;
  color: string;
  description: string;
  creatable: boolean;
  isSystem: boolean;
  sortOrder: number;
  archivedAt: Date | null;
  /** Конфигурация типа (#432): состав карточки и доступ; `{}` — умолчания. */
  config: unknown;
}

/**
 * Строка `process_types` → DTO контракта (+ маршрут из схемы по умолчанию).
 * `creation` — опубликованная форма создания маршрута (#432); без неё форма
 * по умолчанию. `subject` — роли смотрящего: `viewer` считает `typeAccessFor`
 * (одна функция с вебом и моками); без субъекта (внутренние вызовы, где
 * доступ уже проверен) тип считается видимым и создаваемым по `creatable`.
 */
export function processTypeDto(
  row: ProcessTypeRow,
  workflowId: string,
  opts: {
    creation?: unknown;
    subject?: TypeAccessSubject;
    /** Серия нумерации типа (#55), гидрируется сервисом из `number_series`:
     *  префикс живёт там, а config хранит только id. Без серии — null. */
    numbering?: { id: string; prefix: string } | null;
  } = {},
): ProcessType {
  const category = row.category as ProcessCategory;
  const config = normalizeTypeConfig(row.config);
  const numbering =
    config.numbering && opts.numbering?.id === config.numbering.seriesId
      ? {
          seriesId: config.numbering.seriesId,
          prefix: opts.numbering.prefix,
          reset: 'year' as const,
        }
      : null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category,
    direction: (row.direction as LetterDirection | null) ?? null,
    icon: row.icon as ProcessTypeIcon,
    color: row.color as StageColor,
    description: row.description,
    creatable: row.creatable,
    isSystem: row.isSystem,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    workflowId,
    config,
    creationForm: effectiveCreationForm(opts.creation, category),
    viewer: opts.subject
      ? typeAccessFor({ config, creatable: row.creatable }, opts.subject)
      : { canView: true, canCreate: row.creatable },
    numbering,
  };
}

/**
 * Скрытые значения формы — служебные (#432, security-ревью): значение
 * пресета ставит СЕРВЕР, клиенту оно не нужно, а в списке типов его видит
 * каждый, кому виден тип. Смотрящему без `workflow.manage` значения
 * заменяются пустой строкой: признак «поле скрыто» (`preset !== null`)
 * сохраняется, поэтому окно создания по-прежнему не рисует эти поля.
 */
export function maskCreationPresets(type: ProcessType): ProcessType {
  return { ...type, creationForm: maskCreationForm(type.creationForm) };
}

/** Та же маска на уровне формы: `GET /workflows/:id` отдаёт `document.creation`
 *  и не должен раскрывать значения пресетов читателю без `workflow.manage`. */
export function maskCreationForm(form: CreationForm): CreationForm {
  return {
    ...form,
    fields: form.fields.map((slot) =>
      !isCreationSlot(slot) || slot.preset === null ? slot : { ...slot, preset: '' },
    ),
  };
}
