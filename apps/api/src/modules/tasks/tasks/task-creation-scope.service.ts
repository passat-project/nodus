import { Inject, Injectable } from '@nestjs/common';
import {
  creationScopeViolation,
  ErrorCode,
  normalizeTypeConfig,
  type CreationScopeViolation,
  type ProcessType,
} from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';

/** Нарушение настройки «где создаётся» → код ошибки с понятным текстом. */
const CODE_OF: Record<CreationScopeViolation, ErrorCode> = {
  project_type: ErrorCode.PROCESS_TYPE_NOT_ALLOWED_IN_PROJECT,
  project_required: ErrorCode.PROCESS_TYPE_PROJECT_REQUIRED,
  folder_kind: ErrorCode.PROCESS_TYPE_FOLDER_KIND_REQUIRED,
};

/** Место задачи: проект и папка (null — без проекта / вне структуры). */
interface TaskPlace {
  projectId: string | null;
  nodeId: string | null;
}

/**
 * Где можно создавать задачи этого типа (#665, ADR-0041 п.9). Одна проверка
 * на все двери задачи: создание (в проекте, в папке дерева, без проекта),
 * перенос в другой проект/папку и смена типа. Настройка живёт в типе
 * (`config.creation`) и показывается с двух сторон — здесь она исполняется.
 *
 * Права и видимость проекта проверяются отдельно (порт проектов): эта
 * служба отвечает только на вопрос «место подходит типу».
 */
@Injectable()
export class TaskCreationScope {
  constructor(
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
  ) {}

  /** Создание: тип уже разрешён каталогом (категория/доступ — выше). */
  async assertCreate(type: ProcessType, place: TaskPlace): Promise<void> {
    await this.assertPlace(type, place);
  }

  /** Перенос/смена типа: проверяется ИТОГОВОЕ место (смена проекта
   *  обнуляет узел — как в едином писателе полей). Ничего не меняется —
   *  проверки нет (частые правки заголовка не платят лишним чтением). */
  async assertChange(
    task: { typeId: string; projectId: string | null; nodeId: string | null },
    patch: { typeId?: string; projectId?: string | null; nodeId?: string | null },
  ): Promise<void> {
    const projectChanged = patch.projectId !== undefined && patch.projectId !== task.projectId;
    const nodeChanged = patch.nodeId !== undefined && patch.nodeId !== task.nodeId;
    if (!projectChanged && !nodeChanged && patch.typeId === undefined) return;
    const type =
      patch.typeId === undefined || patch.typeId === task.typeId
        ? null
        : await this.catalog.typeById(patch.typeId);
    // Неизвестный тип — не наша забота: отказ даст вызывающий (404).
    if (patch.typeId !== undefined && patch.typeId !== task.typeId && !type) return;
    const target: ProcessType | null = type ?? (await this.catalog.typeById(task.typeId));
    if (!target) return;
    await this.assertPlace(target, {
      projectId: projectChanged ? patch.projectId! : task.projectId,
      nodeId: projectChanged ? null : patch.nodeId !== undefined ? patch.nodeId : task.nodeId,
    });
  }

  private async assertPlace(type: ProcessType, place: TaskPlace): Promise<void> {
    const scope = normalizeTypeConfig(type.config).creation;
    // Пустая настройка (умолчание) — разрешено везде: лишних запросов нет.
    if (
      scope.excludedProjectTypeIds.length === 0 &&
      scope.folderKindId === null &&
      scope.withoutProject
    ) {
      return;
    }
    const projectTypeId =
      place.projectId !== null
        ? ((await this.projects.projectTypeOf(place.projectId))?.id ?? null)
        : null;
    // Модуль проектов выключен или проект не найден: привязку проверяют
    // другие средства (порт видимости), здесь блокировать нечем и не за что.
    if (place.projectId !== null && projectTypeId === null) return;
    const nodeKindId =
      place.projectId !== null && place.nodeId !== null
        ? await this.projects.nodeKindOf(place.projectId, place.nodeId)
        : null;
    const violation = creationScopeViolation(scope, {
      category: type.category,
      projectTypeId,
      nodeKindId,
    });
    if (!violation) return;
    throw new DomainException(CODE_OF[violation], 'Process type is not allowed here', {
      typeId: type.id,
      projectId: place.projectId,
      projectTypeId,
      nodeId: place.nodeId,
      kindId: scope.folderKindId,
    });
  }
}
