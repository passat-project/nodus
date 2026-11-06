import type { InjectionToken } from '@nestjs/common';

/**
 * Порт «где атрибут используется в процессах» (#431; ревизия #631 — без
 * областей): окно последствий и публикация спрашивают порт, какие
 * опубликованные маршруты держат ключ `cf.<uuid>` и в чьих формах создания
 * атрибут стоит слотом. Таблицы процессов принадлежат модулю workflows
 * (I3) — модуль атрибутов читает их только через порт.
 *
 * Места поиска (Р8 #631): окно перехода, валидатор «Заполнены поля»,
 * условие решающего `decider_in` (источник «поле») и форма создания узла
 * «Создание» (отдельным методом — для usage-агрегата).
 */
export const WORKFLOW_FIELD_USAGE_READER: InjectionToken = 'WORKFLOW_FIELD_USAGE_READER';

/** Маршрут, использующий атрибут: `id` — маршрут, `name` — тип процесса. */
export interface WorkflowFieldUsage {
  id: string;
  name: string;
}

/** Тип процесса, в форме создания которого атрибут стоит слотом.
 *  `draft` — форма непубликуемого черновика (удаление не блокирует, но
 *  последствие показывается — Review Focus §9 #631). */
export interface WorkflowCreationFormUsage {
  kind: 'task' | 'letter';
  name: string;
  draft: boolean;
}

export interface WorkflowFieldUsageReader {
  /** Опубликованные маршруты с `cf.<id>` в окне, валидаторе или условии
   *  решающего. `typeId` — только маршруты этого типа (публикация). */
  workflowsUsingField(fieldId: string, opts?: { typeId?: string }): Promise<WorkflowFieldUsage[]>;

  /** Формы создания типов с атрибутом-слотом (окно последствий, Р8). */
  creationFormsUsingField(fieldId: string): Promise<WorkflowCreationFormUsage[]>;
}
