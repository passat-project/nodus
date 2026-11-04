import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { WORKFLOW_EVENTS } from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  CATALOG_PROCESS_TYPES,
  DEFAULT_SCHEME,
  catalogPostFunctions,
  type CatalogStage,
  type CatalogProcessType,
  type CatalogTransition,
  type CatalogWorkflow,
} from './system-catalog.js';
import { parseRules } from '../workflow/transition-rules.js';
import { parseForm } from '../workflow/transition-form.js';
import { CatalogRepository, type CatalogStageData } from './catalog.repository.js';

/** Стадия засеяна; `restate` — каталог сменил её группу (задачи — фоном). */
interface SeededStage {
  id: string;
  restate: boolean;
}

/**
 * Бутстрап системного каталога «Процессов» (ADR-0020/0021/0024): «засев один
 * раз». Пока сущность не правили руками (`customizedAt IS NULL`) и её
 * ревизия меньше текущей — применяется ревизия каталога (создание
 * недостающего, обновление по `code`, архивация живых переходов вне
 * каталога). Настроенное не трогается НИКОГДА (лог `catalog.skip_customized`)
 * — правки владельца переживают рестарты. Применённая ревизия маршрута —
 * системная публикация: версия++ и событие `workflow.published`, чей
 * outbox-обработчик пересчитывает сущности стадий со сменой группы тем же
 * фоновым заданием, что и публикация редактора (события, «Мой план»,
 * completedAt — одна точка адаптера). Идемпотентен; гонка двух стартов
 * разрешается уникальными ключами (повтор проходит по ветке «уже есть»).
 * Личный шаблон «Моего плана» — данные модуля задач (временное исключение
 * ADR-0024 до #438/#439), сеет PersonalTemplateBootstrap там.
 */
@Injectable()
export class CatalogBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly repo: CatalogRepository,
    private readonly eventBus: EventBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CatalogBootstrap.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensure();
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      await this.ensure(); // параллельный старт создал первым — дочитываем
    }
  }

  async ensure(): Promise<void> {
    await this.txRunner.run(async (tx) => {
      const scheme = await this.repo.ensureDefaultScheme(tx, DEFAULT_SCHEME);
      for (const { type: typeDef, workflow: workflowDef } of CATALOG_PROCESS_TYPES) {
        // Серия нумерации (#55): создаётся до типа — её id ложится в
        // config.numbering, из которого движок выдаёт номер.
        const series = typeDef.numbering
          ? await this.repo.ensureSeries(tx, typeDef.numbering)
          : null;
        const type = await this.repo.ensureType(tx, {
          code: typeDef.code,
          name: typeDef.name,
          category: typeDef.category,
          direction: typeDef.direction ?? null,
          icon: typeDef.icon,
          color: typeDef.color,
          description: typeDef.description,
          ...(series ? { config: { numbering: { seriesId: series.id } } } : {}),
        });
        if (!type) {
          // Имя занято пользовательским типом (своё «Комплект» до системного,
          // #467): системный не сеем — дубль имён собьёт выбор типа; старт
          // не рушим. Схема/маршрут тоже не создаются — тип весь пропускается.
          this.logger.warn(
            { type: typeDef.code, name: typeDef.name },
            'catalog.skip_name_clash: имя занято пользовательским типом',
          );
          continue;
        }
        const workflow = await this.repo.ensureWorkflow(tx, {
          code: workflowDef.code,
          name: workflowDef.name,
          kind: workflowDef.kind,
        });
        await this.repo.ensureSchemeEntry(tx, scheme.id, type.id, workflow.id);
        await this.seedOnce(tx, { id: type.id, def: typeDef }, workflow.id, workflowDef);
      }
    });
    this.logger.info('workflows: системный каталог маршрутов на месте');
  }

  /** Применение ревизии каталога к типу и маршруту (если не настроено). */
  private async seedOnce(
    tx: TransactionClient,
    type: { id: string; def: CatalogProcessType } | null,
    workflowId: string,
    def: CatalogWorkflow,
  ): Promise<void> {
    await this.repo.lockWorkflow(tx, workflowId);
    const workflow = await this.repo.seedState(tx, workflowId);
    const typeCustomized = type ? await this.repo.isTypeCustomized(tx, type.id) : false;
    if (workflow.customizedAt !== null || typeCustomized) {
      this.logger.info({ workflow: def.code }, 'catalog.skip_customized: каталог не трогает');
      return;
    }
    if (workflow.catalogRevision >= def.revision) return;

    if (type) {
      const { name, icon, color, description, sortOrder } = type.def;
      await this.repo.applyTypeRevision(
        tx,
        type.id,
        { name, icon, color, description, sortOrder },
        def.revision,
      );
    }

    const stageIds = new Map<string, string>();
    const restates: { stageId: string; systemState: string }[] = [];
    for (const [index, s] of def.stages.entries()) {
      const seeded = await this.seedStage(tx, workflowId, s, index);
      stageIds.set(s.code, seeded.id);
      if (seeded.restate) restates.push({ stageId: seeded.id, systemState: s.systemState });
    }

    const now = new Date();
    const catalogCodes = new Set(def.transitions.map((t) => t.code));
    for (const live of await this.repo.liveTransitions(tx, workflowId)) {
      if (live.code && !catalogCodes.has(live.code)) {
        await this.repo.archiveTransition(tx, live.id, now);
        this.logger.info(
          { workflow: def.code, code: live.code },
          'workflows: переход вне каталога ревизии заархивирован',
        );
      }
    }
    for (const [index, t] of def.transitions.entries()) {
      await this.seedTransition(tx, workflowId, t, index, stageIds);
    }

    const version = await this.repo.applyWorkflowRevision(tx, workflowId, def.revision);
    if (type) {
      await this.eventBus.emit(
        tx,
        WORKFLOW_EVENTS.PUBLISHED,
        { workflowId, typeIds: [type.id], version, category: def.kind, moves: [], restates },
        { actorId: null, aggregateType: 'workflow', aggregateId: workflowId },
      );
    }
  }

  private async seedStage(
    tx: TransactionClient,
    workflowId: string,
    s: CatalogStage,
    index: number,
  ): Promise<SeededStage> {
    const want: CatalogStageData = {
      name: s.name,
      color: s.color,
      sortOrder: index,
      systemState: s.systemState,
      outcome: s.outcome ?? null,
      isInitial: s.isInitial ?? false,
    };
    const found = await this.repo.findStage(tx, workflowId, s.code);
    if (!found) {
      const created = await this.repo.createStage(tx, workflowId, s.code, want);
      return { id: created.id, restate: false };
    }
    const drift = stageDrift(
      {
        name: found.name,
        color: found.color,
        sortOrder: found.sortOrder,
        systemState: found.systemState,
        outcome: found.outcome,
        isInitial: found.isInitial,
      },
      want,
    );
    if (drift) await this.repo.updateStage(tx, found.id, drift);
    const restate = drift?.systemState !== undefined;
    if (restate) {
      this.logger.warn(
        { workflow: workflowId, stage: s.code, systemState: want.systemState },
        'workflows: каталог сменил группу статуса — сущности пересчитаются фоном',
      );
    }
    return { id: found.id, restate };
  }

  private async seedTransition(
    tx: TransactionClient,
    workflowId: string,
    t: CatalogTransition,
    index: number,
    stageIds: Map<string, string>,
  ): Promise<void> {
    const data = {
      name: t.name,
      fromStageId: t.from === null ? null : stageIds.get(t.from)!,
      toStageId: stageIds.get(t.to)!,
      display: t.display,
      intent: t.intent ?? 'action',
      sortOrder: index,
      rules: parseRules({
        ...t.rules,
        postFunctions: catalogPostFunctions(t, stageIds),
      }),
      form: parseForm(t.form ?? {}),
    };
    const found = await this.repo.findTransition(tx, workflowId, t.code);
    if (found) await this.repo.updateTransition(tx, found.id, data);
    else await this.repo.createTransition(tx, workflowId, t.code, data);
  }
}

/** Поля системной стадии, разошедшиеся с каталогом (null — совпадает). */
export function stageDrift(
  found: CatalogStageData,
  want: CatalogStageData,
): Partial<CatalogStageData> | null {
  const drift: Partial<CatalogStageData> = {};
  if (found.name !== want.name) drift.name = want.name;
  if (found.color !== want.color) drift.color = want.color;
  if (found.sortOrder !== want.sortOrder) drift.sortOrder = want.sortOrder;
  if (found.systemState !== want.systemState) drift.systemState = want.systemState;
  if (found.outcome !== want.outcome) drift.outcome = want.outcome;
  if (found.isInitial !== want.isInitial) drift.isInitial = want.isInitial;
  return Object.keys(drift).length > 0 ? drift : null;
}
