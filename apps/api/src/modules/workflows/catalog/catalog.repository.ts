import { Injectable } from '@nestjs/common';
import type { TransitionForm, WorkflowTransitionRules } from '@nodus/contracts';

import type { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { letterSeriesTemplate } from '../numbering/number-template.js';

export interface CatalogStageData {
  name: string;
  color: string;
  sortOrder: number;
  systemState: string;
  outcome: string | null;
  isInitial: boolean;
}

/** Строка типа процесса (полная модель — как create/findUnique). */
type ProcessTypeRow = NonNullable<
  Awaited<ReturnType<TransactionClient['processType']['findUnique']>>
>;

export interface CatalogTransitionData {
  name: string;
  fromStageId: string | null;
  toStageId: string;
  display: string;
  /** Смысл кнопки (#430): action | service. */
  intent: string;
  sortOrder: number;
  rules: WorkflowTransitionRules;
  form: TransitionForm;
}

/** Правила и форма перехода — JSONB (разобраны parseRules/parseForm —
 *  закрытые реестры contracts). */
function json(data: CatalogTransitionData) {
  return {
    ...data,
    rules: data.rules as Prisma.InputJsonValue,
    // AST формул слота (#632) несёт optional-поля — на границе БД это JSON.
    form: data.form as unknown as Prisma.InputJsonValue,
  };
}

/**
 * Системный каталог маршрутов (ADR-0020/0021/0024): записи по `code` — типы
 * процессов, схема, маршруты, стадии, переходы, серии нумерации. Только для
 * бутстрапа (CatalogBootstrap), всё внутри его транзакции; применение —
 * «засев один раз» по ревизии.
 */
@Injectable()
export class CatalogRepository {
  /**
   * Тип по коду (создание с ревизией 0 — seedOnce применит текущую). Null —
   * имя занято другим типом: системный не создаём (дубль имён в библиотеке
   * выбора собьёт пользователя), бутстрап пропускает с предупреждением
   * (#467). Для давно засеянных типов ветка недостижима — находятся по коду.
   */
  async ensureType(
    tx: TransactionClient,
    def: {
      code: string;
      name: string;
      category: string;
      direction: string | null;
      icon: string;
      color: string;
      description: string;
      /** Конфигурация типа: у писем — `numbering` с id серии (#55). */
      config?: Record<string, unknown>;
    },
  ): Promise<ProcessTypeRow | null> {
    const existing = await tx.processType.findUnique({ where: { code: def.code } });
    if (existing) return existing;
    const clash = await tx.processType.findFirst({
      where: { name: def.name },
      select: { id: true },
    });
    if (clash) return null;
    // Создаётся с ревизией 0: seedOnce применит текущую ревизию каталога
    // (создание ≠ применённая ревизия).
    return tx.processType.create({
      data: {
        ...def,
        config: (def.config ?? {}) as Prisma.InputJsonValue,
        isSystem: true,
        catalogRevision: 0,
      },
    });
  }

  /** Серия нумерации по коду (#55 → #630): существующая не перетирается —
   *  правка правила администратором (N7) переживает рестарты. Новые ряды
   *  создаются по схеме правил #630: письмо-шаблон бит-в-бит из prefix,
   *  период «год» (миграция 20261121120000 так же перевела существующие). */
  async ensureSeries(tx: TransactionClient, def: { code: string; prefix: string; name: string }) {
    return (
      (await tx.numberSeries.findUnique({ where: { code: def.code } })) ??
      (await tx.numberSeries.create({
        data: {
          code: def.code,
          prefix: def.prefix,
          reset: 'year',
          name: def.name,
          scopeKind: 'none',
          period: 'year',
          template: letterSeriesTemplate(def.prefix) as unknown as Prisma.InputJsonValue,
          startValue: 1,
        },
      }))
    );
  }

  async ensureDefaultScheme(tx: TransactionClient, def: { code: string; name: string }) {
    return (
      (await tx.workflowScheme.findUnique({ where: { code: def.code } })) ??
      (await tx.workflowScheme.create({ data: { ...def, isDefault: true } }))
    );
  }

  /** Привязка «тип → маршрут» в схеме (существующая не перезаписывается). */
  async ensureSchemeEntry(
    tx: TransactionClient,
    schemeId: string,
    processTypeId: string,
    workflowId: string,
  ): Promise<void> {
    await tx.workflowSchemeEntry.upsert({
      where: { schemeId_processTypeId: { schemeId, processTypeId } },
      update: {},
      create: { schemeId, processTypeId, workflowId },
    });
  }

  /** Блокировка строки маршрута на засев: публикация (тоже FOR UPDATE)
   *  и старт приложения не перетирают друг друга (код-ревью #378). */
  async lockWorkflow(tx: TransactionClient, workflowId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM workflows WHERE id = ${workflowId}::uuid FOR UPDATE`;
  }

  /** Состояние засева маршрута (правили ли руками, какая ревизия применена). */
  seedState(tx: TransactionClient, workflowId: string) {
    return tx.workflow.findUniqueOrThrow({
      where: { id: workflowId },
      select: { customizedAt: true, catalogRevision: true },
    });
  }

  async isTypeCustomized(tx: TransactionClient, typeId: string): Promise<boolean> {
    const row = await tx.processType.findUniqueOrThrow({
      where: { id: typeId },
      select: { customizedAt: true },
    });
    return row.customizedAt !== null;
  }

  /** Свойства типа по ревизии каталога (только поля, которыми владеет каталог). */
  async applyTypeRevision(
    tx: TransactionClient,
    typeId: string,
    def: { name: string; icon: string; color: string; description: string; sortOrder: number },
    revision: number,
  ): Promise<void> {
    await tx.processType.update({
      where: { id: typeId },
      data: { ...def, catalogRevision: revision },
    });
  }

  /** Ревизия применена к маршруту: новая версия (системная публикация —
   *  открытый у кого-то черновик получит конфликт версии, а не затрёт). */
  async applyWorkflowRevision(
    tx: TransactionClient,
    workflowId: string,
    revision: number,
  ): Promise<number> {
    const row = await tx.workflow.update({
      where: { id: workflowId },
      data: { catalogRevision: revision, version: { increment: 1 } },
      select: { version: true },
    });
    return row.version;
  }

  async ensureWorkflow(tx: TransactionClient, def: { code: string; name: string; kind: string }) {
    return (
      (await tx.workflow.findUnique({ where: { code: def.code } })) ??
      // Ревизия 0 при создании: seedOnce посеет стадии/переходы и поднимет
      // до текущей (создание с текущей пропускало бы посев содержимого).
      (await tx.workflow.create({ data: { ...def, isSystem: true, catalogRevision: 0 } }))
    );
  }

  findStage(tx: TransactionClient, workflowId: string, code: string) {
    return tx.workflowStage.findUnique({ where: { workflowId_code: { workflowId, code } } });
  }

  createStage(tx: TransactionClient, workflowId: string, code: string, data: CatalogStageData) {
    return tx.workflowStage.create({ data: { workflowId, code, ...data } });
  }

  async updateStage(
    tx: TransactionClient,
    stageId: string,
    data: Partial<CatalogStageData>,
  ): Promise<void> {
    await tx.workflowStage.update({ where: { id: stageId }, data });
  }

  findTransition(tx: TransactionClient, workflowId: string, code: string) {
    return tx.workflowTransition.findUnique({ where: { workflowId_code: { workflowId, code } } });
  }

  /** Живые переходы маршрута (для архивации неcatalogочных при посеве). */
  liveTransitions(tx: TransactionClient, workflowId: string) {
    return tx.workflowTransition.findMany({
      where: { workflowId, archivedAt: null },
      select: { id: true, code: true },
    });
  }

  async createTransition(
    tx: TransactionClient,
    workflowId: string,
    code: string,
    data: CatalogTransitionData,
  ): Promise<void> {
    await tx.workflowTransition.create({ data: { workflowId, code, ...json(data) } });
  }

  async updateTransition(
    tx: TransactionClient,
    transitionId: string,
    data: CatalogTransitionData,
  ): Promise<void> {
    await tx.workflowTransition.update({
      where: { id: transitionId },
      data: { ...json(data), archivedAt: null },
    });
  }

  async archiveTransition(tx: TransactionClient, transitionId: string, now: Date): Promise<void> {
    await tx.workflowTransition.update({
      where: { id: transitionId },
      data: { archivedAt: now },
    });
  }
}
