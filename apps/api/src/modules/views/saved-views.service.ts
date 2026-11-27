import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  normalizeTypeConfig,
  Permission,
  type AuthUser,
  type CreateSavedViewBody,
  type ListEntity,
  type SavedView,
  type UpdateSavedViewBody,
} from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import { PROJECT_READER, type ProjectReader } from '../projects/ports/project-reader.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../workflows/ports/process-catalog-reader.port.js';
import { savedViewDto, resolveLevel, SavedViewsRepository } from './saved-views.repository.js';

/** Чем является пользователь для рамки проекта. */
type FrameRole = 'management' | 'member' | 'visible' | 'hidden';

/**
 * Сохранённые настройки списков (#435): три уровня (личная / общая проектная
 * / список типа по умолчанию) и три рамки (журнал / проект / тип). Рамка
 * «снять нельзя»: она — место хранения настройки, при применении фильтр
 * рамки НЕ снимается (GET /tasks?projectId= у вкладки проекта).
 *
 * Права: проектную общую создаёт и правит руководство проекта
 * (руководитель/помощник или project.manage); личную — участник рамки
 * (в журнале — любой); список типа по умолчанию — настройщик процессов
 * (workflow.manage). Секретный проект не-участнику — 404 без оракула.
 * Настройка — не сущность данных: событий нет (I13, потребителей нет),
 * мутации — в аудит; удаление физическое.
 */
@Injectable()
export class SavedViewsService {
  constructor(
    private readonly repo: SavedViewsRepository,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
  ) {}

  async create(user: AuthUser, body: CreateSavedViewBody): Promise<SavedView> {
    const level = resolveLevel(body);
    // Явный level обязан соответствовать рамке: журнал — личная, тип —
    // type_default, проект — личная или общая (контракт #435).
    if (body.level !== undefined && body.level !== level) {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'View level does not match its scope',
        { scope: body.scope.kind, level: body.level },
      );
    }
    await this.assertCanWrite(user, body, level);
    const row = await this.repo.create(body, level, user.id);
    return savedViewDto(row);
  }

  /** Настройки рамки: журнал (личные), проект (общие + личние + списки типов,
   * создаваемых в проекте), тип (каталог настройщика). */
  async list(
    user: AuthUser,
    frame:
      | { kind: 'journal'; entity?: ListEntity }
      | { kind: 'project'; projectId: string; entity?: ListEntity }
      | { kind: 'type'; typeId: string },
  ): Promise<SavedView[]> {
    if (frame.kind === 'journal') {
      return (await this.repo.personalOf(user.id, frame.entity)).map(savedViewDto);
    }
    if (frame.kind === 'type') {
      this.assertWorkflowManage(user);
      return (await this.repo.typeDefaults([frame.typeId])).map(savedViewDto);
    }
    const role = await this.frameRole(user, frame.projectId);
    if (role === 'hidden') throw DomainException.notFound('Project not found');
    const [shared, personal, typeDefaults] = await Promise.all([
      this.repo.projectOf(frame.projectId),
      this.repo.personalInProject(user.id, frame.projectId),
      this.creatableTypeDefaults(frame.projectId),
    ]);
    const all = [...shared, ...personal, ...typeDefaults].filter(
      (row) => !frame.entity || row.entity === frame.entity,
    );
    // Стабильный порядок: общие → списки типов → личные (вкладки проекта).
    const rank = (row: (typeof all)[number]) =>
      row.level === 'project' ? 0 : row.level === 'type_default' ? 1 : 2;
    return all
      .sort((a, b) => rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime())
      .map(savedViewDto);
  }

  async update(user: AuthUser, id: string, patch: UpdateSavedViewBody): Promise<SavedView> {
    const row = await this.rowForWrite(user, id);
    return savedViewDto(await this.repo.update(row.id, row, patch));
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const row = await this.rowForWrite(user, id);
    await this.repo.remove(row.id);
  }

  private async assertCanWrite(
    user: AuthUser,
    body: CreateSavedViewBody,
    level: ReturnType<typeof resolveLevel>,
  ): Promise<void> {
    if (body.scope.kind === 'journal') return; // личная в журнале — любой
    if (body.scope.kind === 'type_default') {
      this.assertWorkflowManage(user);
      return;
    }
    const role = await this.frameRole(user, body.scope.projectId);
    if (role === 'hidden') throw DomainException.notFound('Project not found');
    // Личную в проекте — участник рамки; общую — только руководство.
    const need: FrameRole[] = level === 'project' ? ['management'] : ['management', 'member'];
    if (!need.includes(role)) {
      throw DomainException.forbidden('Only project management can manage shared views');
    }
  }

  /** Строка настройки + право на неё: чужая личная — 404 (без оракула),
   * проектная без руководства — 403, типа — workflow.manage. */
  private async rowForWrite(user: AuthUser, id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw DomainException.notFound('Saved view not found');
    if (row.level === 'personal') {
      if (row.ownerId !== user.id) throw DomainException.notFound('Saved view not found');
      return row;
    }
    if (row.level === 'type_default') {
      this.assertWorkflowManage(user);
      return row;
    }
    const role = await this.frameRole(user, row.projectId!);
    if (role === 'hidden') throw DomainException.notFound('Saved view not found');
    if (role !== 'management') {
      throw DomainException.forbidden('Only project management can manage shared views');
    }
    return row;
  }

  /** Роль пользователя в рамке проекта: руководство / участник / видит /
   * скрыт (секретный без участия — как несуществующий). */
  private async frameRole(user: AuthUser, projectId: string): Promise<FrameRole> {
    const roles = await this.projects.rolesIn(user.id, [projectId]);
    const mine = roles[projectId] ?? [];
    if (
      mine.some((role) => role === 'manager' || role === 'assistant') ||
      user.permissions.includes(Permission.PROJECT_MANAGE)
    ) {
      return 'management';
    }
    if (mine.length > 0) return 'member';
    const scope = await this.projects.freshViewScopeFor({
      id: user.id,
      permissions: user.permissions,
    });
    return scope.visibleProjectIds.includes(projectId) ? 'visible' : 'hidden';
  }

  private assertWorkflowManage(user: AuthUser): void {
    if (!user.permissions.includes(Permission.WORKFLOW_MANAGE)) {
      throw new DomainException(ErrorCode.FORBIDDEN, 'Workflow management permission required');
    }
  }

  /** Списки типов по умолчанию, чьи типы создаются в проекте (#665
   * «где создаётся»): настройка появляется готовой вкладкой там, где тип
   * живёт; `withoutProject` и исключённые типы проектов — не подходят. */
  private async creatableTypeDefaults(projectId: string) {
    const candidates = await this.repo.allTypeDefaults();
    const projectType = await this.projects.projectTypeOf(projectId);
    const allowed: typeof candidates = [];
    for (const row of candidates) {
      if (row.typeId === null) continue;
      const type = await this.catalog.typeById(row.typeId);
      if (!type || type.archivedAt) continue;
      const creation = normalizeTypeConfig(type.config).creation;
      if (creation.withoutProject) continue;
      if (projectType && creation.excludedProjectTypeIds.includes(projectType.id)) continue;
      allowed.push(row);
    }
    return allowed;
  }
}
