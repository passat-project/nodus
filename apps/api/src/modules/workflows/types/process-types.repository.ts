import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { parseRules } from '../workflow/transition-rules.js';
import { parseForm } from '../workflow/transition-form.js';
import type { LoadedWorkflow } from '../workflow/workflow.repository.js';

/**
 * Библиотека типов процессов (#378, ADR-0024): CRUD типов и копирование
 * маршрутов-основ. Код типов из редактора генерирует сервер
 * (`custom-<8 символов>`); копия маршрута получает НОВЫЕ id стадий/переходов
 * (цели route_if перемапливаются), version 1 и считается опубликованной.
 */
@Injectable()
export class ProcessTypesRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(archived: 'exclude' | 'include' | 'only', category?: string) {
    return this.prisma.processType.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(archived === 'include'
          ? {}
          : archived === 'only'
            ? { archivedAt: { not: null } }
            : { archivedAt: null }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  /** Типы по id пачкой (гидратация DTO сущностей). */
  findByIds(ids: readonly string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.processType.findMany({ where: { id: { in: [...ids] } } });
  }

  /** Серии нумерации пачкой (#55): префикс для DTO типа. */
  seriesRefs(ids: readonly string[]): Promise<{ id: string; prefix: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.numberSeries.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, prefix: true },
    });
  }

  /** Системный тип по коду каталога (запасной тип создания). */
  findByCode(code: string) {
    return this.prisma.processType.findUnique({ where: { code } });
  }

  /** Живой тип по id (смена типа задачи). */
  findLiveById(id: string) {
    return this.prisma.processType.findFirst({ where: { id, archivedAt: null } });
  }

  /** Тип по id, включая архивные (настройки, архивация/восстановление). */
  findById(id: string) {
    return this.prisma.processType.findUnique({ where: { id } });
  }

  createType(tx: TransactionClient, data: Prisma.ProcessTypeUncheckedCreateInput) {
    return tx.processType.create({ data });
  }

  async updateType(
    tx: TransactionClient,
    id: string,
    data: Prisma.ProcessTypeUncheckedUpdateInput,
  ): Promise<void> {
    await tx.processType.update({ where: { id }, data });
  }

  /** Конфигурация типа целиком (#432): разделы заменяются, не сливаются. */
  async updateConfig(tx: TransactionClient, id: string, config: unknown): Promise<void> {
    await tx.processType.update({
      where: { id },
      data: { config: config as Prisma.InputJsonValue, customizedAt: new Date() },
    });
  }

  findLiveByName(name: string, exceptId?: string) {
    return this.prisma.processType.findFirst({
      where: { name, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
  }

  async maxSortOrder(): Promise<number> {
    const last = await this.prisma.processType.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }

  async workflowIdOf(typeId: string): Promise<string> {
    const entry = await this.prisma.workflowSchemeEntry.findFirst({
      where: { processTypeId: typeId, scheme: { isDefault: true } },
      select: { workflowId: true },
    });
    if (!entry) throw DomainException.notFound('Workflow for process type not found');
    return entry.workflowId;
  }

  /** workflowId по каждому живому типу (для списка). */
  async workflowMap(): Promise<Map<string, string>> {
    const entries = await this.prisma.workflowSchemeEntry.findMany({
      where: { scheme: { isDefault: true } },
      select: { processTypeId: true, workflowId: true },
    });
    return new Map(entries.map((e) => [e.processTypeId, e.workflowId]));
  }

  /** Опубликованная форма создания по каждому маршруту (#432): список типов
   *  отдаёт её в DTO — один запрос на весь список, а не на строку. */
  async creationMap(workflowIds: readonly string[]): Promise<Map<string, unknown>> {
    const unique = [...new Set(workflowIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.workflow.findMany({
      where: { id: { in: unique } },
      select: { id: true, creation: true },
    });
    return new Map(rows.map((row) => [row.id, row.creation]));
  }

  /** Копия маршрута-основы: новые id, каталог-кодов нет, route_if цели
   *  перемапливаются на новые стадии. Возвращает id нового маршрута. */
  async copyWorkflow(
    tx: TransactionClient,
    source: LoadedWorkflow,
    def: {
      name: string;
      publishedById: string;
      /** Вид маршрута = категория сущности (task | letter). */
      kind: string;
      code?: string;
      publishedAt?: Date | null;
      /** Форма создания основы (#432): копия типа работает как оригинал. */
      creation?: unknown;
    },
  ): Promise<string> {
    const created = await tx.workflow.create({
      data: {
        code: def.code ?? null,
        name: def.name,
        kind: def.kind,
        version: 1,
        publishedAt: def.publishedAt ?? new Date(),
        publishedById: def.publishedById,
        customizedAt: new Date(),
        ...(def.creation === undefined || def.creation === null
          ? {}
          : { creation: def.creation as Prisma.InputJsonValue }),
      },
    });
    const idMap = new Map<string, string>();
    for (const stage of source.stages) {
      const copy = await tx.workflowStage.create({
        data: {
          workflowId: created.id,
          code: null,
          name: stage.name,
          color: stage.color,
          sortOrder: stage.sortOrder,
          systemState: stage.systemState,
          outcome: stage.outcome,
          isInitial: stage.isInitial,
        },
      });
      idMap.set(stage.id, copy.id);
    }
    for (const transition of source.transitions) {
      const rules = parseRules(transition.rules);
      const postFunctions = rules.postFunctions.map((pf) =>
        pf.kind === 'route_if' ? { ...pf, toStageId: idMap.get(pf.toStageId) ?? pf.toStageId } : pf,
      );
      await tx.workflowTransition.create({
        data: {
          workflowId: created.id,
          code: null,
          name: transition.name,
          fromStageId: transition.fromStageId ? (idMap.get(transition.fromStageId) ?? null) : null,
          toStageId: idMap.get(transition.toStageId) ?? transition.toStageId,
          display: transition.display,
          intent: transition.intent,
          sortOrder: transition.sortOrder,
          rules: { ...rules, postFunctions } as Prisma.InputJsonValue,
          // Окно при нажатии — часть документа маршрута (#380): копия типа
          // несёт его вместе с правилами.
          form: parseForm(transition.form) as Prisma.InputJsonValue,
        },
      });
    }
    return created.id;
  }

  /** Привязки атрибутов основы → новому типу (#432; #631 — field_bindings):
   *  копия типа работает как оригинал — окна скопированного маршрута
   *  ссылаются на те же атрибуты, и без привязок публикация копии падала бы
   *  `custom_field_not_in_type`. */
  async copyTypeBindings(
    tx: TransactionClient,
    fromTypeId: string,
    toTypeId: string,
  ): Promise<void> {
    const rows = await tx.fieldBinding.findMany({
      where: { targetKind: 'process_type', targetId: fromTypeId },
      select: { definitionId: true },
    });
    if (rows.length === 0) return;
    await tx.fieldBinding.createMany({
      data: rows.map((row) => ({
        definitionId: row.definitionId,
        targetKind: 'process_type',
        targetId: toTypeId,
      })),
      skipDuplicates: true,
    });
  }

  async attachToDefaultScheme(tx: TransactionClient, typeId: string, workflowId: string) {
    const scheme = await tx.workflowScheme.findFirstOrThrow({ where: { isDefault: true } });
    await tx.workflowSchemeEntry.upsert({
      where: { schemeId_processTypeId: { schemeId: scheme.id, processTypeId: typeId } },
      update: { workflowId },
      create: { schemeId: scheme.id, processTypeId: typeId, workflowId },
    });
  }

  /** Простой маршрут-основа «Ожидает → В работе → Завершена». */
  createSimpleWorkflow(
    tx: TransactionClient,
    def: { name: string; publishedById: string; kind: string },
  ) {
    return this.copyWorkflow(tx, SIMPLE_WORKFLOW, def);
  }
}

/** Минимальный маршрут «в памяти» для основы simple. */
const SIMPLE_WORKFLOW: LoadedWorkflow = {
  id: 'simple',
  stages: [
    {
      id: 's-new',
      code: null,
      name: 'Ожидает',
      systemState: 'backlog',
      archivedAt: null,
      workflowId: 'simple',
      color: 'neutral',
      sortOrder: 0,
      isInitial: true,
      outcome: null,
    },
    {
      id: 's-wip',
      code: null,
      name: 'В работе',
      systemState: 'active',
      archivedAt: null,
      workflowId: 'simple',
      color: 'success',
      sortOrder: 1,
      isInitial: false,
      outcome: null,
    },
    {
      id: 's-done',
      code: null,
      name: 'Завершена',
      systemState: 'closed',
      archivedAt: null,
      workflowId: 'simple',
      color: 'info',
      sortOrder: 2,
      isInitial: false,
      outcome: 'success',
    },
  ],
  transitions: [
    {
      id: 't-start',
      name: 'Взять в работу',
      fromStageId: 's-new',
      toStageId: 's-wip',
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: parseRules({ conditions: [{ kind: 'role_in', roles: ['assignee', 'coexecutor'] }] }),
      form: parseForm({}),
    },
    {
      id: 't-complete',
      name: 'Завершить',
      fromStageId: 's-wip',
      toStageId: 's-done',
      display: 'primary',
      intent: 'action',
      sortOrder: 1,
      rules: parseRules({
        conditions: [{ kind: 'role_in', roles: ['assignee'] }],
        validators: [{ kind: 'no_open_subtasks' }],
      }),
      form: parseForm({}),
    },
  ],
};
