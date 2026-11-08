import { Inject, Injectable } from '@nestjs/common';
import type { CustomFieldNumbering, NumberSeriesRule } from '@nodus/contracts';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  NUMBER_SERIES_STORE,
  type NumberSeriesStore,
} from '../../workflows/ports/number-series.port.js';
import {
  WORKFLOW_FIELD_USAGE_READER,
  type WorkflowFieldUsageReader,
} from '../../workflows/ports/workflow-field-usage.port.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';
import { NUMBER_HOST_REGISTRY, type NumberHostRegistry } from '../ports/number-host.port.js';
import { NumberIssueService } from './number-issue.service.js';

/**
 * Сводка счётчика для DTO определения (#630): правило серии, «при создании»
 * по привязкам, пример номера, «выдано номеров», «ещё без номера» и кнопки
 * опубликованных маршрутов. Живёт рядом с реестром атрибутов: карточка
 * счётчика получает всё одним ответом, без N+1 на клиенте.
 */
@Injectable()
export class CounterSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBER_SERIES_STORE) private readonly series: NumberSeriesStore,
    @Inject(NUMBER_HOST_REGISTRY) private readonly hosts: NumberHostRegistry,
    @Inject(WORKFLOW_FIELD_USAGE_READER) private readonly usage: WorkflowFieldUsageReader,
    private readonly engine: NumberIssueService,
  ) {}

  /** Сводки по строкам реестра: ключ — id определения. Не-счётчики и
   *  счётчики без правила пропускаются (numbering = null). */
  async summaries(
    rows: readonly FieldDefinitionRow[],
    tx?: TransactionClient,
  ): Promise<Map<string, CustomFieldNumbering>> {
    const counters = rows.filter((row) => row.type === 'counter' && row.numberSeriesId !== null);
    if (counters.length === 0) return new Map();
    const db = (tx ?? this.prisma) as TransactionClient;
    const seriesIds = counters.flatMap((row) => (row.numberSeriesId ? [row.numberSeriesId] : []));
    const [series, issued] = await Promise.all([
      this.series.byIds(db, seriesIds),
      this.series.issuedCounts(db, seriesIds),
    ]);
    const seriesById = new Map(series.map((entry) => [entry.id, entry]));
    const out = new Map<string, CustomFieldNumbering>();
    for (const row of counters) {
      const data = row.numberSeriesId ? seriesById.get(row.numberSeriesId) : undefined;
      if (!data) continue;
      const rule: NumberSeriesRule = {
        containers: data.containers,
        period: data.period,
        template: data.template,
        startValue: data.startValue,
        step: data.step,
      };
      const participants = [
        ...row.bindings
          .filter((binding) => binding.targetKind === 'process_type')
          .map((binding) => binding.targetId),
        ...row.bindings
          .filter((binding) => binding.targetKind === 'project_type')
          .map((binding) => binding.targetId),
        ...row.bindings
          .filter((binding) => binding.targetKind === 'node_kind')
          .map((binding) => binding.targetId),
      ];
      const [issuers, withoutNumber] = await Promise.all([
        this.usage.numberIssuers(row.id),
        this.hosts.countWithoutNumber(db, participants, row.id),
      ]);
      out.set(row.id, {
        rule,
        onCreate: row.bindings
          .filter((binding) => binding.numberOnCreate === true)
          .map((binding) => binding.targetId)
          .sort(),
        preview: this.engine.preview(rule),
        issuedCount: issued.get(data.id) ?? 0,
        withoutNumber,
        issuers,
      });
    }
    return out;
  }
}
