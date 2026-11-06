import { Inject, Injectable } from '@nestjs/common';
import type { FormulaAggregateFrom, FormulaHostKind, FormulaNode } from '@nodus/contracts';
import { FORMULA_LIMITS } from '@nodus/contracts';
import type { FormulaRecord, FormulaResolver, FormulaSingleSource } from '@nodus/formula-engine';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import {
  RECORD_VALUES_READER,
  type FormulaRecordData,
  type RecordValuesReader,
} from '../ports/record-values.port.js';
import { FORMULA_ENGINE, type FormulaEngine } from '../ports/formula-engine.port.js';
import { buildDepKeys, type FormulaDepKey } from './formula-dep-keys.js';
import {
  companyRecord,
  findRelationNode,
  neededSources,
  relationRows,
} from './formula-context.helpers.js';
import type { FormulaRegistrySnapshot } from './formula-meta.service.js';
import { FormulaValuesService } from './formula-values.service.js';

/** Собранный контекст вычисления: резолвер движка + зависимости + хост. */
export interface FormulaContext {
  resolver: FormulaResolver;
  host: FormulaRecordData;
  /** Ключи formula_deps: что должно измениться для пересчёта (Р4). */
  depKeys: FormulaDepKey[];
  /** Выборка агрегата превысила лимит записей (Р13 `selection_limit`). */
  overflowed: boolean;
  /** Формула места хоста для атрибута (Р6): null — у привязки формулы нет. */
  placeFormula(fieldId: string): FormulaNode | null;
}

export interface FormulaContextArgs {
  hostKind: FormulaHostKind;
  hostId: string;
  asts: readonly FormulaNode[];
  snapshot: FormulaRegistrySnapshot;
  /** Пользовательский путь (evaluate): невидимый хост = null (Р7). */
  actor?: ProjectActor;
}

/**
 * Сборка контекста формулы (#632, Р6/Р7): батч-чтение источников (запись,
 * родитель, проект, срез папок, связанные, компания) и единственная точка
 * фильтрации видимости — резолверы портов. Движок не умеет читать мимо
 * резолвера, поэтому правила Р7 не обходятся ни одним путём вычисления:
 * PUT/evaluate/пересчёт/формула типа/префилл окна.
 */
@Injectable()
export class FormulaContextService {
  constructor(
    @Inject(RECORD_VALUES_READER) private readonly reader: RecordValuesReader,
    @Inject(FORMULA_ENGINE) private readonly engine: FormulaEngine,
    private readonly values: FormulaValuesService,
  ) {}

  /** Контекст хоста; null — записи нет или она не видна актору (404). */
  async build(args: FormulaContextArgs, tx?: TransactionClient): Promise<FormulaContext | null> {
    const { hostKind, hostId, asts, snapshot, actor } = args;
    const host = await this.reader.record(hostKind, hostId, actor ? { actor } : undefined, tx);
    if (!host) return null;

    const deps = asts.flatMap((ast) => this.engine.extractDeps(ast));
    const needed = neededSources(deps);

    const projectId = hostKind === 'project' ? host.id : host.projectId;
    const project =
      hostKind === 'project'
        ? host
        : projectId
          ? await this.reader.record('project', projectId, undefined, tx)
          : null;

    const nodes =
      needed.folders || needed.nodeTasks
        ? new Map(
            (projectId ? await this.reader.projectNodes(projectId, tx) : []).map((node) => [
              node.id,
              node,
            ]),
          )
        : new Map<string, FormulaRecordData>();

    const parent =
      needed.parent && host.parentId
        ? await this.reader.record('task', host.parentId, undefined, tx)
        : null;

    let overflowed = false;
    const related = new Map<string, FormulaRecordData[]>();
    if (needed.subtasks) {
      const rows = await this.reader.subtasks(host.id, tx);
      if (rows.length > FORMULA_LIMITS.selection) overflowed = true;
      related.set('subtasks', rows);
    }
    for (const dep of deps) {
      if (dep.kind !== 'related' || !dep.selector || dep.selector === 'subtasks') continue;
      if (dep.selector === 'node_tasks') {
        const nodeId = hostKind === 'node' ? host.id : host.nodeId;
        if (!nodeId) continue;
        const rows = await this.reader.nodeTasks(nodeId, tx);
        if (rows.length > FORMULA_LIMITS.selection) overflowed = true;
        related.set('node_tasks', rows);
        continue;
      }
      // Связи: выборка зависит от вида и направления — ключ селектора.
      const relation = findRelationNode(asts);
      if (!relation) continue;
      const rows = await this.reader.relatedTasks(
        host.id,
        relation.relation,
        relation.direction,
        tx,
      );
      if (rows.length > FORMULA_LIMITS.selection) overflowed = true;
      related.set(`relations:${relation.relation}:${relation.direction}`, rows);
    }

    const company = companyRecord(snapshot);

    // Справочники — одной пачкой по всем записям, которые увидят формулы.
    const records: Pick<FormulaRecordData, 'values'>[] = [
      host,
      ...(project ? [project] : []),
      ...(parent ? [parent] : []),
    ];
    records.push(...nodes.values());
    for (const rows of related.values()) records.push(...rows);
    records.push(company);
    const items = await this.values.loadItems(records, snapshot.byId, tx);

    // Цели атрибутов-ссылок — лениво (по номеру), с кэшем на контекст.
    const refCache = new Map<number, FormulaRecordData | null>();
    const refRecord = async (number: number): Promise<FormulaRecordData | null> => {
      const cached = refCache.get(number);
      if (cached !== undefined) return cached;
      const target = await this.resolveRef(host, number, snapshot, tx);
      refCache.set(number, target);
      return target;
    };
    if (needed.refs) {
      for (const dep of deps) {
        if (dep.kind === 'ref' && dep.refField !== undefined) await refRecord(dep.refField);
      }
    }

    const toRecord = (data: FormulaRecordData | null): FormulaRecord | null =>
      data ? this.values.toRecord(data, snapshot.byNumber, items) : null;
    const hostRecord = this.values.toRecord(host, snapshot.byNumber, items);

    const chainOf = (kindId: string): FormulaRecordData[] => {
      // Цепочка — ПРЕДКИ (сама запись — `self`, Р2/Р6): у папки-хоста
      // начинается с родителя, у задачи — с её узла.
      const chain: FormulaRecordData[] = [];
      let currentId: string | null = hostKind === 'node' ? host.parentId : host.nodeId;
      const guard = new Set<string>();
      while (currentId && !guard.has(currentId)) {
        guard.add(currentId);
        const node = nodes.get(currentId);
        if (!node) break;
        if (node.placeId === kindId) chain.push(node);
        currentId = node.parentId;
      }
      return chain.reverse();
    };

    const nearestFolder = (kindId: string): FormulaRecordData | null => {
      let currentId: string | null = hostKind === 'node' ? host.id : host.nodeId;
      const guard = new Set<string>();
      while (currentId && !guard.has(currentId)) {
        guard.add(currentId);
        const node = nodes.get(currentId);
        if (!node) return null;
        if (node.placeId === kindId) return node;
        currentId = node.parentId;
      }
      return null;
    };

    const visibleParent = (): FormulaRecordData | null => {
      // Р7 (в): родитель — только тот же проект и не конфиденциальный.
      if (!parent || parent.confidential) return null;
      if ((parent.projectId ?? null) !== (host.projectId ?? null)) return null;
      return parent;
    };

    const resolver: FormulaResolver = {
      single: (source: FormulaSingleSource) => {
        switch (source.kind) {
          case 'self':
            return hostRecord;
          case 'parent_task':
            return toRecord(visibleParent());
          case 'folder_nearest':
            return toRecord(nearestFolder(source.kindId));
          case 'project':
            return toRecord(project);
          case 'company':
            return this.values.toRecord(company, snapshot.byNumber, items);
          case 'ref_field':
            return toRecord(refCache.get(source.field) ?? null);
          default:
            return null;
        }
      },
      select: (from: FormulaAggregateFrom) => {
        if (from.kind === 'folder_chain') {
          return chainOf(from.kindId)
            .map((node) => this.values.toRecord(node, snapshot.byNumber, items))
            .filter((record): record is FormulaRecord => record !== null);
        }
        const selector = from.selector.kind;
        const rows =
          selector === 'subtasks'
            ? (related.get('subtasks') ?? [])
            : selector === 'node_tasks'
              ? (related.get('node_tasks') ?? [])
              : relationRows(related, asts);
        return rows
          .map((row) => this.values.toRecord(row, snapshot.byNumber, items))
          .filter((record): record is FormulaRecord => record !== null);
      },
    };

    return {
      resolver,
      host,
      depKeys: buildDepKeys({
        host,
        hostKind,
        project,
        nodes,
        parent: visibleParent(),
        related,
        asts,
        deps,
        snapshot,
      }),
      overflowed,
      placeFormula: (fieldId: string) =>
        host.placeId
          ? (snapshot.bindingFormulas
              .get(host.placeId)
              ?.find((entry) => entry.definitionId === fieldId)?.ast ?? null)
          : null,
    };
  }

  /** Цель атрибута-ссылки: только своё дерево и не конфиденциальные (Р7). */
  private async resolveRef(
    host: FormulaRecordData,
    number: number,
    snapshot: FormulaRegistrySnapshot,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData | null> {
    const definition = snapshot.byNumber.get(number);
    if (!definition) return null;
    const raw = host.values[definition.id];
    if (raw === undefined || raw === null || Array.isArray(raw) || typeof raw === 'object') {
      return null;
    }
    const targetId = String(raw);
    switch (definition.type) {
      case 'task':
      case 'node':
      case 'project': {
        const target = await this.reader.record(definition.type, targetId, undefined, tx);
        if (!target || target.confidential) return null;
        // Цель обязана быть в проекте хоста (Р7 г) — иначе источник недоступен.
        const hostProject = host.kind === 'project' ? host.id : host.projectId;
        if ((target.projectId ?? null) !== (hostProject ?? null)) return null;
        return target;
      }
      default:
        // Письмо/контрагент источниками атрибутов V1 не являются (O5).
        return null;
    }
  }
}
