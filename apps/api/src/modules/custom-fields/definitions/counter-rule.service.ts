import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  numberContainerReachable,
  numberCreateTriggerProblem,
  type CustomFieldBindings,
  type NumberContainer,
  type NumberHostKind,
  type NumberSeriesRule,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import {
  NUMBER_SERIES_STORE,
  type NumberSeriesStore,
} from '../../workflows/ports/number-series.port.js';
import { DefinitionsRepository } from './definitions.repository.js';

/** Хост привязки: тип процесса — по категории, тип проекта и вид папки — свои. */
function hostOfBinding(
  targetKind: 'process_type' | 'project_type' | 'node_kind',
  category: 'task' | 'letter' | null,
): NumberHostKind {
  if (targetKind === 'node_kind') return 'node';
  if (targetKind === 'project_type') return 'project';
  return category === 'letter' ? 'letter' : 'task';
}

/**
 * Правило счётчика и «при создании» на привязках (#630, модель v3):
 * проверки ДО мутации (422/409), запись серии 1:1 с определением и флагов
 * `field_bindings.number_on_create`. Отдельный сервис — определения живут
 * в `DefinitionsService`, правила серий — здесь (I5).
 */
@Injectable()
export class CounterRuleService {
  constructor(
    private readonly definitions: DefinitionsRepository,
    @Inject(NUMBER_SERIES_STORE) private readonly series: NumberSeriesStore,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
  ) {}

  /** `numbering`/`numberingOnCreate` — только счётчику; «следующий номер»
   *  сквозного счёта — только без условий «отдельно для». */
  assertShape(
    type: string,
    dto: {
      numbering?: NumberSeriesRule;
      numberingOnCreate?: readonly string[];
      numberingNext?: number;
    },
  ): void {
    if (type !== 'counter' && dto.numbering !== undefined) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Numbering is only for counters', {
        type,
      });
    }
    if (type !== 'counter' && dto.numberingOnCreate !== undefined) {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'Create trigger is only for counters',
        { type },
      );
    }
    if (
      dto.numberingNext !== undefined &&
      (type !== 'counter' || dto.numbering === undefined || dto.numbering.containers.length > 0)
    ) {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'Next number is only for a company-wide counter',
        { type },
      );
    }
  }

  /** Все привязки достижимы для условий правила: письмо не лежит в папке,
   *  проект — в проекте, папка — в проекте. */
  async assertReachable(rule: NumberSeriesRule, bindings: CustomFieldBindings): Promise<void> {
    const targets: string[] = [];
    const processRefs = await this.catalog.typeRefs(bindings.processTypeIds, { live: true });
    const categoryById = new Map(processRefs.map((ref) => [ref.id, ref.category]));
    for (const id of bindings.processTypeIds) {
      const host = hostOfBinding('process_type', categoryById.get(id) ?? null);
      if (!reachable(rule.containers, host)) targets.push(id);
    }
    for (const id of bindings.projectTypeIds) {
      if (!reachable(rule.containers, 'project')) targets.push(id);
    }
    for (const id of bindings.nodeKindIds) {
      if (!reachable(rule.containers, 'node')) targets.push(id);
    }
    if (targets.length > 0) {
      throw new DomainException(
        ErrorCode.NUMBER_CONTAINER_UNREACHABLE,
        'Binding cannot lie inside the counter conditions',
        { targets },
      );
    }
  }

  /**
   * «При создании» только у привязанных типов; письму — только сквозная
   * нумерация/по типу письма и без полей письма в номере (иначе импорт почты
   * падал бы без человека, который подтвердит пустую вставку); папке и
   * проекту без «при создании» номер не выдаст никто — кнопок у них нет.
   */
  async assertTriggers(
    rule: NumberSeriesRule,
    onCreate: readonly string[],
    bindings: CustomFieldBindings,
  ): Promise<void> {
    const bound = new Set([
      ...bindings.processTypeIds,
      ...bindings.projectTypeIds,
      ...bindings.nodeKindIds,
    ]);
    const invalid = onCreate.filter((id) => !bound.has(id));
    const processRefs = await this.catalog.typeRefs(bindings.processTypeIds, { live: true });
    const categoryById = new Map(processRefs.map((ref) => [ref.id, ref.category]));
    for (const id of onCreate) {
      if (
        categoryById.get(id) === 'letter' &&
        numberCreateTriggerProblem(rule, 'letter') !== null
      ) {
        invalid.push(id);
      }
    }
    for (const id of bindings.nodeKindIds) if (!onCreate.includes(id)) invalid.push(id);
    for (const id of bindings.projectTypeIds) if (!onCreate.includes(id)) invalid.push(id);
    if (invalid.length > 0) {
      throw new DomainException(ErrorCode.NUMBER_TRIGGER_INVALID, 'Invalid create trigger', {
        targets: [...new Set(invalid)],
      });
    }
  }

  /** После первой выдачи «вести счёт отдельно для» и «начинать заново» не
   *  меняются — иначе номера начнут повторяться. */
  async assertNotLocked(
    tx: TransactionClient,
    seriesId: string | null,
    next: NumberSeriesRule,
  ): Promise<void> {
    if (!seriesId) return;
    const [issued, current] = await Promise.all([
      this.series.issuedCounts(tx, [seriesId]),
      this.series.byId(tx, seriesId),
    ]);
    if ((issued.get(seriesId) ?? 0) === 0 || !current) return;
    const sameConditions =
      JSON.stringify(current.containers) === JSON.stringify(next.containers) &&
      current.period === next.period;
    if (!sameConditions) {
      throw new DomainException(
        ErrorCode.NUMBER_RULE_LOCKED,
        'Counter conditions are locked after the first issue',
        { seriesId },
      );
    }
  }

  /** Текущее правило серии (null — серии нет). */
  async ruleOf(tx: TransactionClient, seriesId: string): Promise<NumberSeriesRule | null> {
    const series = await this.series.byId(tx, seriesId);
    if (!series) return null;
    return {
      containers: series.containers,
      period: series.period,
      template: series.template,
      startValue: series.startValue,
      step: series.step,
    };
  }

  /** Записать правило: существующая серия — правка, нет — создание 1:1. */
  async applyRule(
    tx: TransactionClient,
    definitionId: string,
    currentSeriesId: string | null,
    name: string,
    rule: NumberSeriesRule,
  ): Promise<string> {
    if (currentSeriesId) {
      await this.series.update(tx, currentSeriesId, { name, rule });
      return currentSeriesId;
    }
    const seriesId = await this.series.create(tx, {
      code: `counter-${definitionId}`,
      name,
      rule,
    });
    await this.definitions.setNumberSeries(definitionId, seriesId, tx);
    return seriesId;
  }

  /** Флаги «при создании» по привязкам (после замены привязок в той же tx). */
  async applyOnCreate(
    tx: TransactionClient,
    definitionId: string,
    onCreate: readonly string[],
  ): Promise<void> {
    await this.definitions.setNumberOnCreate(definitionId, onCreate, tx);
  }

  /** Продолжение нумерации сквозного счёта из Excel — в той же транзакции. */
  async applyNext(
    tx: TransactionClient,
    seriesId: string,
    nextValue: number | undefined,
  ): Promise<void> {
    if (nextValue === undefined) return;
    await this.series.setNext(tx, seriesId, { hits: [], nextValue });
  }
}

function reachable(containers: readonly NumberContainer[], host: NumberHostKind): boolean {
  return containers.every((container) => numberContainerReachable(container, host));
}
