import { Inject, Injectable } from '@nestjs/common';
import type { CustomFieldDefinition, CustomFieldModule, CustomFieldUsage } from '@nodus/contracts';

import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { DefinitionMapper } from './definition.mapper.js';
import { requireDefinition } from './definition-guards.js';
import { DefinitionsUsageService } from './definitions-usage.service.js';
import { DefinitionsRepository } from './definitions.repository.js';

/**
 * Чтения реестра атрибутов (#631): список с фильтром модуля и агрегат
 * последствий удаления. Вынесено из `DefinitionsService` ради лимита строк
 * файла (I5): записи и чтения — разные ответственности, зависимости те же.
 */
@Injectable()
export class DefinitionsQueryService {
  constructor(
    private readonly definitions: DefinitionsRepository,
    private readonly mapper: DefinitionMapper,
    private readonly usageReader: DefinitionsUsageService,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
  ) {}

  /** Реестр портала; `module` — фильтр по привязкам/категории (Р11). */
  async list(
    module: CustomFieldModule | null,
    actor?: ProjectActor,
  ): Promise<CustomFieldDefinition[]> {
    const rows = await this.definitions.list();
    if (!module) return this.mapper.toDtos(rows, undefined, actor);
    if (module === 'company') {
      return this.mapper.toDtos(
        rows.filter((row) => row.isCompany),
        undefined,
        actor,
      );
    }
    if (module === 'project' || module === 'node') {
      const kind = module === 'project' ? 'project_type' : 'node_kind';
      return this.mapper.toDtos(
        rows.filter((row) => row.bindings.some((b) => b.targetKind === kind)),
        undefined,
        actor,
      );
    }
    // task/letter: привязка к живому типу своей категории (типы письма не
    // делают атрибут «задачным» и наоборот).
    const refs = await this.catalog.typeRefs(
      rows.flatMap((row) =>
        row.bindings.filter((b) => b.targetKind === 'process_type').map((b) => b.targetId),
      ),
      { live: true },
    );
    const categoryTypes = new Set(
      refs.filter((ref) => ref.category === module).map((ref) => ref.id),
    );
    return this.mapper.toDtos(
      rows.filter((row) =>
        row.bindings.some((b) => b.targetKind === 'process_type' && categoryTypes.has(b.targetId)),
      ),
      undefined,
      actor,
    );
  }

  /** Где используется: агрегат последствий для окна удаления (Р8). */
  async usage(id: string): Promise<CustomFieldUsage> {
    return this.usageReader.usage(await requireDefinition(this.definitions, id));
  }
}
