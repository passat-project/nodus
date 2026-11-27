import { Inject, Injectable } from '@nestjs/common';
import type {
  ConditionSubject,
  TransitionBlockReason,
  WorkflowCondition,
  WorkflowValidator,
} from '@nodus/contracts';

import type { ProjectActor } from '../../../projects/ports/project-reader.port.js';
import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import {
  CONDITION_RECORDS_READER,
  type ConditionHost,
  type ConditionRecordData,
  type ConditionRecordsReader,
} from '../../../custom-fields/ports/condition-records.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../../custom-fields/ports/custom-field-registry.port.js';
import {
  FORMULA_CELLS,
  type FormulaCells,
} from '../../../custom-fields/ports/formula-cells.port.js';
import { ProcessTypesRepository } from '../../types/process-types.repository.js';
import { WorkflowRepository } from '../workflow.repository.js';
import type { ConditionStageIndex, ConditionStageInfo } from './condition-logic.js';
import { evaluateSelection, recordsReason } from './condition-logic.js';

/** Условия/проверки общей выборки и формулы (#635). */
export type ConditionRule =
  | Extract<WorkflowCondition, { kind: 'records' | 'formula' }>
  | Extract<WorkflowValidator, { kind: 'records' | 'formula' }>;

/**
 * Рантайм одного вызова движка: индекс стадий и определения атрибутов
 * читаются один раз на available/execute, повторные правила (одна и та же
 * проверка у нескольких кнопок) не пересчитываются.
 */
export interface ConditionRuntime {
  /** Условие «кто и когда видит кнопку» (#635): истинно ли. */
  conditionPasses(rule: ConditionRule): Promise<boolean>;
  /** Проверка-валидатор (#635): причина блокировки или null (пройдена). */
  validatorReason(rule: ConditionRule): Promise<TransitionBlockReason | null>;
}

type ConditionGate = Extract<WorkflowValidator, { kind: 'records' | 'formula' }>;

/**
 * Единственный вход вычисления общей выборки (#635, unified-model §7 «Одна
 * выборка на всё»): условия кнопок (прячет), проверки (не пускает, причина),
 * завтра — шаги (#634), правила (#448), показатели папки (#865), фильтр
 * списков (#435). Множества записей читает порт CONDITION_RECORDS_READER
 * (полный состав — квантор честный; видимость актора фильтрует причину),
 * формулы — FORMULA_CELLS.evaluate; стадии с отметками «результат выдан» —
 * репозитории своего модуля.
 */
@Injectable()
export class ConditionEvaluator {
  constructor(
    @Inject(CONDITION_RECORDS_READER) private readonly records: ConditionRecordsReader,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly registry: CustomFieldRegistry,
    private readonly types: ProcessTypesRepository,
    private readonly workflows: WorkflowRepository,
  ) {}

  async runtime(
    tx: TransactionClient,
    host: ConditionHost,
    actor: ProjectActor,
  ): Promise<ConditionRuntime> {
    const defs = new Map(
      (await this.registry.definitions({}, tx)).map((definition) => [definition.id, definition]),
    );
    const typeStages = new Map<string, Map<string, ConditionStageInfo>>();
    const stageIndex: ConditionStageIndex = { stages: typeStages };
    const selectionCache = new Map<string, ConditionRecordData[]>();
    const conditionCache = new Map<string, boolean>();
    const reasonCache = new Map<string, TransitionBlockReason | null>();

    const selectionOf = async (subject: ConditionSubject): Promise<ConditionRecordData[]> => {
      const key = JSON.stringify(subject);
      const cached = selectionCache.get(key);
      if (cached !== undefined) return cached;
      const rows = await this.records.selection(host, subject, tx);
      selectionCache.set(key, rows);
      return rows;
    };

    const ensureStages = async (typeIds: readonly string[]): Promise<void> => {
      for (const typeId of typeIds) {
        if (typeStages.has(typeId)) continue;
        // Выборка может содержать записи без маршрута (проект, папка: их
        // typeId — тип проекта/вид папки, схемы этапов у них нет, #856):
        // предикаты этапа/итога/«результат выдан» по ним ложны, а не 404
        // всей кнопочной панели записи.
        const workflowId = await this.types.workflowIdOf(typeId).catch(() => null);
        const stages = workflowId ? await this.workflows.findStages(workflowId, tx) : [];
        typeStages.set(
          typeId,
          new Map(
            stages.map((stage) => [
              stage.id,
              {
                systemState: stage.systemState,
                outcome: stage.outcome,
                resultIssued: stage.resultIssued,
              },
            ]),
          ),
        );
      }
    };

    const typeIdsOf = (records: readonly ConditionRecordData[]): string[] => [
      ...new Set(records.map((record) => record.typeId).filter((id): id is string => id !== null)),
    ];

    const evaluateRecords = async (
      rule: Extract<ConditionRule, { kind: 'records' }>,
    ): Promise<{ passed: boolean; violators: ConditionRecordData[] }> => {
      const records = await selectionOf(rule.query.subject);
      await ensureStages(typeIdsOf(records));
      // ConditionRecordData структурно покрывает ConditionRow логики.
      return evaluateSelection(records, rule.query.where, rule.query.quantifier, stageIndex, defs);
    };

    const evaluateFormula = async (
      ast: Extract<ConditionRule, { kind: 'formula' }>['formula'],
    ): Promise<boolean> => {
      const result = await this.cells.evaluate(host.kind, host.id, ast, { actor, tx });
      return result.error === null && result.value === true;
    };

    const visibleOf = async (
      violators: readonly ConditionRecordData[],
    ): Promise<ReadonlySet<string>> => this.records.visibleOf(violators, actor, tx);

    return {
      async conditionPasses(rule: ConditionRule): Promise<boolean> {
        const key = JSON.stringify(rule);
        const cached = conditionCache.get(key);
        if (cached !== undefined) return cached;
        const passed =
          rule.kind === 'records'
            ? (await evaluateRecords(rule)).passed
            : await evaluateFormula(rule.formula);
        conditionCache.set(key, passed);
        return passed;
      },
      async validatorReason(rule: ConditionGate): Promise<TransitionBlockReason | null> {
        const key = JSON.stringify(rule);
        if (reasonCache.has(key)) return reasonCache.get(key)!;
        let reason: TransitionBlockReason | null = null;
        if (rule.kind === 'records') {
          const { passed, violators } = await evaluateRecords(rule);
          if (!passed) {
            reason = recordsReason(rule.title, violators, await visibleOf(violators));
          }
        } else if (!(await evaluateFormula(rule.formula))) {
          reason = { kind: 'formula', title: rule.title };
        }
        reasonCache.set(key, reason);
        return reason;
      },
    };
  }
}
