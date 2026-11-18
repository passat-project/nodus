import { z } from 'zod';

/**
 * Где создаются записи типа (ADR-0041 п.9, #665): одна связь «тип процесса ×
 * место создания», которая живёт в настройках САМОГО типа и показывается с
 * двух сторон — в типе проекта («Что здесь можно создавать») и в типе задачи
 * или письма («Где создаётся»). Второй копии настройки нет.
 *
 * Модель исключений: по умолчанию тип разрешён везде (посев не ломает
 * сегодняшнее поведение), настройщик отмечает типы проектов, где его НЕТ.
 * Так «разрешён в единственном проекте» вычисляется без материализации
 * списка всех типов проектов, а новый тип проекта автоматически разрешает
 * всё, пока его не сузят.
 */
export const creationScopeSchema = z
  .object({
    /** Типы проектов, где этот тип создавать нельзя (пусто — везде можно). */
    excludedProjectTypeIds: z.array(z.uuid()).max(100),
    /** Задача создаётся только в папке этого вида; null — где угодно.
     *  У писем всегда null (папки — только у задач). */
    folderKindId: z.uuid().nullable(),
    /** Можно создать без проекта. У писем не проверяется: письмо
     *  регистрируется без проекта всегда (ADR-0041 п.10). */
    withoutProject: z.boolean(),
  })
  .strict();
export type CreationScope = z.infer<typeof creationScopeSchema>;

/** Пустая настройка: разрешено везде, без проекта можно, вне папок можно. */
export const DEFAULT_CREATION_SCOPE: CreationScope = {
  excludedProjectTypeIds: [],
  folderKindId: null,
  withoutProject: true,
};

/** Настройка целиком или умолчание: битый раздел не роняет карточку типа. */
export function normalizeCreationScope(raw: unknown): CreationScope {
  const parsed = creationScopeSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_CREATION_SCOPE;
}

/** Место создания: проект (и его тип) и папка (и её вид), если они есть. */
export interface CreationPlace {
  category: 'task' | 'letter';
  /** Тип проекта; null — создаётся без проекта. */
  projectTypeId: string | null;
  /** Вид папки, в которой создаётся задача; null — вне папки. */
  nodeKindId: string | null;
}

/** Что именно нарушено; null — создавать можно. */
export type CreationScopeViolation = 'project_type' | 'project_required' | 'folder_kind';

/**
 * Одна проверка для всех путей создания и переноса (сервер — истина, I8):
 * тип проекта не исключён, «без проекта» разрешено, папка нужного вида.
 * Интерфейс фильтрует списки тем же правилом — импортирует эту функцию.
 */
export function creationScopeViolation(
  scope: CreationScope,
  place: CreationPlace,
): CreationScopeViolation | null {
  if (place.projectTypeId !== null) {
    if (scope.excludedProjectTypeIds.includes(place.projectTypeId)) return 'project_type';
  } else if (place.category === 'task' && !scope.withoutProject) {
    return 'project_required';
  }
  if (scope.folderKindId !== null && place.nodeKindId !== scope.folderKindId) {
    return 'folder_kind';
  }
  return null;
}

/** Тип разрешён в этом типе проекта (для галочек «Что здесь можно создавать»). */
export function typeAllowedInProjectType(scope: CreationScope, projectTypeId: string): boolean {
  return !scope.excludedProjectTypeIds.includes(projectTypeId);
}

/**
 * Настройка после галочки в типе проекта (#665): обе стороны правят ОДНУ
 * связь — выключение добавляет тип проекта в исключения, включение убирает.
 * Пустой список исключений = «разрешено везде» (умолчание и посев).
 */
export function withProjectTypeAllowed(
  scope: CreationScope,
  projectTypeId: string,
  allowed: boolean,
): CreationScope {
  if (allowed) {
    return {
      ...scope,
      excludedProjectTypeIds: scope.excludedProjectTypeIds.filter((id) => id !== projectTypeId),
    };
  }
  if (scope.excludedProjectTypeIds.includes(projectTypeId)) return scope;
  return { ...scope, excludedProjectTypeIds: [...scope.excludedProjectTypeIds, projectTypeId] };
}
