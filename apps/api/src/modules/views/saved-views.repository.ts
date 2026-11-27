import { Injectable } from '@nestjs/common';
import type {
  CreateSavedViewBody,
  ListEntity,
  ListViewLevel,
  ListViewScope,
  SavedView,
  UpdateSavedViewBody,
} from '@nodus/contracts';

import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';

/** Настройка вида в строке: рамка + уровень (+ дубль колонками для индексов). */
type SavedViewRow = Prisma.SavedViewGetPayload<Record<string, never>>;

/**
 * Хранилище сохранённых настроек списков (#435): таблица `saved_views`.
 * Права и семантику рамки проверяет сервис — репозиторий только CRUD.
 */
@Injectable()
export class SavedViewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(body: CreateSavedViewBody, level: ListViewLevel, actorId: string): Promise<SavedViewRow> {
    return this.prisma.savedView.create({
      data: {
        name: body.name,
        entity: body.entity,
        level,
        scopeKind: body.scope.kind,
        scopeJson: body.scope as object,
        configJson: configOf(body) as unknown as Prisma.InputJsonValue,
        ownerId: level === 'personal' ? actorId : null,
        projectId: body.scope.kind === 'project' ? body.scope.projectId : null,
        typeId: body.scope.kind === 'type_default' ? body.scope.typeId : null,
        createdBy: actorId,
      },
    });
  }

  findById(id: string): Promise<SavedViewRow | null> {
    return this.prisma.savedView.findUnique({ where: { id } });
  }

  /** Правка настройки: имя и/или части конфига — поверх ХРАНЯЩЕГОСЯ
   * конфига (частичная замена разделов, как у секций типов). Рамку и уровень
   * настроенного вида не меняют: рамка — место хранения (вкладка проекта
   * остаётся вкладкой проекта), уровень — права. */
  async update(
    id: string,
    current: SavedViewRow,
    patch: UpdateSavedViewBody,
  ): Promise<SavedViewRow> {
    const config: SavedViewConfig = { ...(current.configJson as unknown as SavedViewConfig) };
    if (patch.filter !== undefined) config.filter = patch.filter;
    if (patch.sort !== undefined) config.sort = patch.sort;
    if (patch.group !== undefined) config.group = patch.group ?? null;
    if (patch.totals !== undefined) config.totals = patch.totals;
    if (patch.columns !== undefined) config.columns = patch.columns;
    const data: Prisma.SavedViewUpdateInput = {
      configJson: config as unknown as Prisma.InputJsonValue,
    };
    if (patch.name !== undefined) data.name = patch.name;
    return this.prisma.savedView.update({ where: { id }, data });
  }

  remove(id: string): Promise<void> {
    return this.prisma.savedView.delete({ where: { id } }).then(() => undefined);
  }

  /** Личные настройки пользователя (рамка журнала: сущность любая). */
  personalOf(ownerId: string, entity?: ListEntity): Promise<SavedViewRow[]> {
    return this.prisma.savedView.findMany({
      where: { level: 'personal', scopeKind: 'journal', ownerId, ...(entity ? { entity } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Настройки личной рамки проекта (владелец — пользователь). */
  personalInProject(ownerId: string, projectId: string): Promise<SavedViewRow[]> {
    return this.prisma.savedView.findMany({
      where: { level: 'personal', scopeKind: 'project', ownerId, projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Общие проектные настройки рамки. */
  projectOf(projectId: string): Promise<SavedViewRow[]> {
    return this.prisma.savedView.findMany({
      where: { level: 'project', projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Списки типов по умолчанию (настройка у типа). */
  typeDefaults(typeIds: readonly string[]): Promise<SavedViewRow[]> {
    if (typeIds.length === 0) return Promise.resolve([]);
    return this.prisma.savedView.findMany({
      where: { level: 'type_default', typeId: { in: [...new Set(typeIds)] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Все списки типов по умолчанию (каталог настройщика). */
  allTypeDefaults(): Promise<SavedViewRow[]> {
    return this.prisma.savedView.findMany({
      where: { level: 'type_default' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}

/** Уровень из рамки и явного level: журнал — только личная, тип — только
 * type_default, проект — личная (умолчание) или общая проектная. Несовместимую
 * комбинацию отвергает сервис (422) до записи. */
export function resolveLevel(body: CreateSavedViewBody): ListViewLevel {
  switch (body.scope.kind) {
    case 'journal':
      return 'personal';
    case 'type_default':
      return 'type_default';
    case 'project':
      return body.level === 'project' ? 'project' : 'personal';
  }
}

function configOf(body: Partial<CreateSavedViewBody>): SavedViewConfig {
  return {
    filter: body.filter ?? [],
    sort: body.sort ?? [],
    group: body.group ?? null,
    totals: body.totals ?? [],
    columns: body.columns ?? [],
  };
}

/** Форма configJson строки (разделы настройки вида). */
interface SavedViewConfig {
  filter: CreateSavedViewBody['filter'];
  sort: CreateSavedViewBody['sort'];
  group: CreateSavedViewBody['group'] | null;
  totals: CreateSavedViewBody['totals'];
  columns: CreateSavedViewBody['columns'];
}

/** Строка → DTO контракта. */
export function savedViewDto(row: SavedViewRow): SavedView {
  const config = row.configJson as {
    filter?: SavedView['filter'];
    sort?: SavedView['sort'];
    group?: SavedView['group'] | null;
    totals?: SavedView['totals'];
    columns?: SavedView['columns'];
  };
  return {
    id: row.id,
    name: row.name,
    entity: row.entity as SavedView['entity'],
    scope: row.scopeJson as ListViewScope,
    level: row.level as ListViewLevel,
    filter: config.filter ?? [],
    sort: config.sort ?? [],
    group: config.group ?? undefined,
    totals: config.totals ?? [],
    columns: config.columns ?? [],
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}
