import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  normalizeTypeConfig,
  typeAccessFor,
  type ProcessCategory,
  type ProcessType,
  type ProcessTypeIcon,
  type ProcessTypeRef,
} from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  ROLE_MEMBERSHIP_READER,
  type RoleMembershipReader,
} from '../../../core/ports/role-membership.port.js';
import { STANDARD_PROCESS_TYPE } from '../catalog/system-catalog.js';
import { processTypeDto } from '../types/process-type.mapper.js';
import { ProcessTypesRepository } from '../types/process-types.repository.js';
import { typeSubjectOf } from '../types/type-subject.js';
import { WorkflowRepository } from '../workflow/workflow.repository.js';
import type {
  CatalogStage,
  CatalogStageWithType,
  ProcessCatalogReader,
} from './process-catalog-reader.port.js';

/**
 * Реализация read-порта «Процессов» для модулей-владельцев (ADR-0012,
 * ADR-0024): гидратация типов и стадий, разрешение типа в маршрут с
 * проверкой категории/архива/доступа, каталог стадий. Наружу отдаются
 * только контракты и формы порта — таблицы «Процессов» не утекают.
 *
 * #432: доступ к типу — часть разрешения (Р6): одна функция `typeAccessFor`
 * с вебом и моками, роли смотрящего — из порта ролей (прямые ∪ подразделения).
 */
@Injectable()
export class ProcessCatalogReaderProvider implements ProcessCatalogReader {
  constructor(
    private readonly types: ProcessTypesRepository,
    private readonly workflows: WorkflowRepository,
    @Inject(ROLE_MEMBERSHIP_READER) private readonly membership: RoleMembershipReader,
  ) {}

  async resolveType(
    typeId: string | undefined,
    opts: { category: ProcessCategory; requireCreatable?: boolean; actorId?: string },
  ): Promise<ProcessType> {
    const type = typeId
      ? await this.types.findLiveById(typeId)
      : await this.types.findByCode(STANDARD_PROCESS_TYPE.code);
    // Чужая категория — как отсутствие: задача не может идти по маршруту
    // письма (и наоборот); оракул существования не раскрываем.
    if (!type || type.archivedAt || type.category !== opts.category) {
      throw new DomainException(ErrorCode.NOT_FOUND, 'Process type not found');
    }
    const workflowId = await this.types.workflowIdOf(type.id);
    const creation = await this.workflows.creationOf(workflowId);
    if (!opts.actorId) {
      if (opts.requireCreatable && !type.creatable) {
        throw new DomainException(ErrorCode.CONFLICT, 'Process type is not available for creation');
      }
      return processTypeDto(type, workflowId, { creation });
    }
    const subject = await typeSubjectOf(this.membership, opts.actorId);
    const viewer = typeAccessFor(
      { config: normalizeTypeConfig(type.config), creatable: type.creatable },
      subject,
    );
    if (!viewer.canView) {
      throw new DomainException(ErrorCode.PROCESS_TYPE_FORBIDDEN, 'Process type is not available', {
        typeId: type.id,
        reason: 'view',
      });
    }
    if (opts.requireCreatable && !viewer.canCreate) {
      throw new DomainException(ErrorCode.PROCESS_TYPE_FORBIDDEN, 'Process type is not available', {
        typeId: type.id,
        reason: 'not_creatable',
      });
    }
    return processTypeDto(type, workflowId, { creation, subject });
  }

  async typeById(id: string): Promise<ProcessType | null> {
    const type = await this.types.findById(id);
    if (!type) return null;
    const workflowId = await this.types.workflowIdOf(type.id).catch(() => '');
    const creation = workflowId ? await this.workflows.creationOf(workflowId) : null;
    return processTypeDto(type, workflowId, { creation });
  }

  async resolveTypeByCode(
    code: string,
    opts: { category: ProcessCategory },
  ): Promise<ProcessType | null> {
    const type = await this.types.findByCode(code);
    if (!type || type.archivedAt || type.category !== opts.category) return null;
    const workflowId = await this.types.workflowIdOf(type.id);
    const creation = await this.workflows.creationOf(workflowId);
    return processTypeDto(type, workflowId, { creation });
  }

  async typeRefs(ids: readonly string[], opts: { live?: boolean } = {}): Promise<ProcessTypeRef[]> {
    if (ids.length === 0) return [];
    const rows = await this.types.findByIds(ids);
    return rows
      .filter((t) => !opts.live || t.archivedAt === null)
      .map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        category: t.category as ProcessCategory,
        icon: t.icon as ProcessTypeIcon,
        color: t.color as ProcessType['color'],
      }));
  }

  liveStages(workflowId: string): Promise<CatalogStage[]> {
    return this.workflows.findStages(workflowId);
  }

  stagesByIds(ids: readonly string[]): Promise<CatalogStage[]> {
    return ids.length === 0 ? Promise.resolve([]) : this.workflows.stagesByIds(ids);
  }

  async findLiveStage(stageId: string): Promise<CatalogStage | null> {
    const stage = await this.workflows.findStageById(stageId);
    return stage && stage.archivedAt === null ? stage : null;
  }

  async stagesCatalog(opts: {
    typeId?: string;
    category: ProcessCategory;
    viewerId?: string;
  }): Promise<CatalogStageWithType[]> {
    if (opts.typeId) {
      const type = await this.resolveType(opts.typeId, {
        category: opts.category,
        ...(opts.viewerId ? { actorId: opts.viewerId } : {}),
      });
      const stages = await this.workflows.findStages(type.workflowId);
      return stages.map((s) => ({ ...s, typeId: type.id, typeName: type.name }));
    }
    const types = await this.visibleTypes(opts.category, opts.viewerId);
    const workflowMap = await this.types.workflowMap();
    const result: CatalogStageWithType[] = [];
    for (const type of types) {
      const workflowId = workflowMap.get(type.id);
      if (!workflowId) continue;
      const stages = await this.workflows.findStages(workflowId);
      result.push(...stages.map((s) => ({ ...s, typeId: type.id, typeName: type.name })));
    }
    return result;
  }

  /** Живые типы категории, видимые смотрящему (без `viewerId` — все). */
  private async visibleTypes(category: ProcessCategory, viewerId?: string) {
    const rows = await this.types.list('exclude', category);
    if (!viewerId) return rows;
    const subject = await typeSubjectOf(this.membership, viewerId);
    return rows.filter(
      (row) =>
        typeAccessFor(
          { config: normalizeTypeConfig(row.config), creatable: row.creatable },
          subject,
        ).canView,
    );
  }
}
