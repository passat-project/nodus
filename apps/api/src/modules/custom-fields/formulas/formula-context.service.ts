import { Inject, Injectable } from '@nestjs/common';
import type { FormulaAggregateFrom, FormulaHostKind, FormulaNode } from '@nodus/contracts';
import { FORMULA_LIMITS } from '@nodus/contracts';
import type { FormulaRecord, FormulaResolver, FormulaSingleSource } from '@nodus/formula-engine';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { DictionaryItemRef } from '../../dictionaries/ports/dictionary-reader.port.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import {
  RECORD_VALUES_READER,
  type FormulaRecordData,
  type RecordValuesReader,
} from '../ports/record-values.port.js';
import type { FormulaPreviewOverride } from '../ports/formula-cells.port.js';
import { FORMULA_ENGINE, type FormulaEngine } from '../ports/formula-engine.port.js';
import { buildDepKeys, type FormulaDepKey } from './formula-dep-keys.js';
import { companyRecord, neededSources, resolveRefSource } from './formula-context.helpers.js';
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

/** Кэш источников на одну операцию (#632, Р6): список из N записей одного
 *  проекта читает проект/срез папок/компанию один раз, а не N раз. */
export interface FormulaContextCache {
  records: Map<string, Promise<FormulaRecordData | null>>;
  nodes: Map<string, Promise<FormulaRecordData[]>>;
  items: Map<string, DictionaryItemRef>;
}

export function createFormulaCache(): FormulaContextCache {
  return { records: new Map(), nodes: new Map(), items: new Map() };
}

export interface FormulaContextArgs {
  hostKind: FormulaHostKind;
  hostId: string;
  asts: readonly FormulaNode[];
  snapshot: FormulaRegistrySnapshot;
  /** Пользовательский путь (evaluate): невидимый хост = null (Р7). */
  actor?: ProjectActor;
  /** Dry-run переноса (move-preview): подмена места без записи в БД. */
  override?: FormulaPreviewOverride;
  /** Синтетический хост (префилл создания, Р12): записи ещё нет — контекст
   *  задаёт место (проект/папка/родитель), значения пустые. */
  hostData?: FormulaRecordData;
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
  async build(
    args: FormulaContextArgs,
    tx?: TransactionClient,
    cache: FormulaContextCache = createFormulaCache(),
  ): Promise<FormulaContext | null> {
    const { hostKind, hostId, asts, snapshot, actor, override } = args;
    const loaded = args.hostData ?? (await this.record(hostKind, hostId, actor, tx, cache));
    if (!loaded) return null;
    const host = withOverride(loaded, override);

    const deps = asts.flatMap((ast) => this.engine.extractDeps(ast));
    const needed = neededSources(deps);

    const projectId = hostKind === 'project' ? host.id : host.projectId;
    const project =
      hostKind === 'project'
        ? host
        : projectId
          ? await this.record('project', projectId, undefined, tx, cache)
          : null;

    const nodes =
      needed.folders || needed.nodeTasks
        ? new Map(
            (projectId ? await this.projectNodes(projectId, tx, cache) : []).map((node) => [
              node.id,
              withOverride(node, override),
            ]),
          )
        : new Map<string, FormulaRecordData>();

    const parent =
      needed.parent && host.parentId
        ? await this.record('task', host.parentId, undefined, tx, cache)
        : null;

    let overflowed = false;
    const related = new Map<string, FormulaRecordData[]>();
    if (needed.subtasks) {
      const rows = await this.reader.subtasks(host.id, tx);
      if (rows.length > FORMULA_LIMITS.selection) overflowed = true;
      related.set('subtasks', rows);
    }
    if (needed.nodeTasks) {
      const nodeId = hostKind === 'node' ? host.id : host.nodeId;
      // Папка обязана принадлежать проекту хоста: аномальный nodeId из
      // чужих данных не должен приносить задачи чужого проекта (Р7).
      if (nodeId && nodes.has(nodeId)) {
        const rows = await this.nodeTasksAt(nodeId, override, tx, cache);
        if (rows.length > FORMULA_LIMITS.selection) overflowed = true;
        related.set('node_tasks', rows);
      }
    }
    for (const dep of deps) {
      if (dep.kind !== 'related' || dep.selector !== 'relations') continue;
      if (!dep.relation || !dep.direction || host.kind !== 'task') continue;
      // Связи: каждая пара вид+направление — своя выборка и свой ключ (Р2):
      // формула может агрегировать несколько видов связей сразу.
      const key = `relations:${dep.relation}:${dep.direction}`;
      if (related.has(key)) continue;
      const rows = await this.reader.relatedTasks(host.id, dep.relation, dep.direction, tx);
      if (rows.length > FORMULA_LIMITS.selection) overflowed = true;
      related.set(key, rows);
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
    const items = await this.values.loadItems(records, snapshot.byId, tx, cache.items);

    // Цели атрибутов-ссылок — лениво (по номеру), с кэшем на контекст.
    const refCache = new Map<number, FormulaRecordData | null>();
    const refRecord = async (number: number): Promise<FormulaRecordData | null> => {
      const cached = refCache.get(number);
      if (cached !== undefined) return cached;
      const target = await resolveRefSource(host, number, snapshot, tx, cache, this, actor);
      refCache.set(number, target);
      return target;
    };
    if (needed.refs) {
      for (const dep of deps) {
        // Системное поле цели ссылки (`{Ссылка · Название}`) тоже требует
        // предзагрузки цели — иначе резолвер всегда отдаёт null (Р2).
        if ((dep.kind === 'ref' || dep.kind === 'system') && dep.refField !== undefined) {
          await refRecord(dep.refField);
        }
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
      // Без проекта «своё дерево» не определено: личная задача не должна
      // читать чужого родителя (участническая видимость безпроектных задач).
      if (!parent || parent.confidential || host.projectId === null) return null;
      if ((parent.projectId ?? null) !== host.projectId) return null;
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
        const selector = from.selector;
        const rows =
          selector.kind === 'subtasks'
            ? (related.get('subtasks') ?? [])
            : selector.kind === 'node_tasks'
              ? (related.get('node_tasks') ?? [])
              : (related.get(`relations:${selector.relation}:${selector.direction}`) ?? []);
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

  /** Запись-источник с кэшем операции: один проект/родитель на страницу. */
  async record(
    kind: FormulaHostKind,
    id: string,
    actor: ProjectActor | undefined,
    tx: TransactionClient | undefined,
    cache: FormulaContextCache,
  ): Promise<FormulaRecordData | null> {
    const key = `${kind}:${id}:${actor?.id ?? '-'}`;
    const cached = cache.records.get(key);
    if (cached) return cached;
    const promise = this.reader.record(kind, id, actor ? { actor } : undefined, tx);
    cache.records.set(key, promise);
    return promise;
  }

  private async projectNodes(
    projectId: string,
    tx: TransactionClient | undefined,
    cache: FormulaContextCache,
  ): Promise<FormulaRecordData[]> {
    const cached = cache.nodes.get(projectId);
    if (cached) return cached;
    const promise = this.reader.projectNodes(projectId, tx);
    cache.nodes.set(projectId, promise);
    return promise;
  }

  /**
   * Состав «задач папки» с подменой места (move-preview, Р10): задача,
   * которую переносят, ещё лежит в старой папке БД. Без этой подмены дифф
   * показывал бы старую папку с ушедшей задачей и новую — без неё, то есть
   * обещал бы не то, что пересчитает перенос.
   */
  private async nodeTasksAt(
    nodeId: string,
    override: FormulaPreviewOverride | undefined,
    tx: TransactionClient | undefined,
    cache: FormulaContextCache,
  ): Promise<FormulaRecordData[]> {
    const rows = await this.reader.nodeTasks(nodeId, tx);
    const moved = override?.taskNode;
    if (!moved) return rows;
    const movedOut = new Set<string>();
    const movedIn: string[] = [];
    for (const [taskId, target] of Object.entries(moved)) {
      if (target === nodeId) movedIn.push(taskId);
      else movedOut.add(taskId);
    }
    if (movedOut.size === 0 && movedIn.length === 0) return rows;
    const kept = rows.filter((row) => !movedOut.has(row.id));
    const present = new Set(kept.map((row) => row.id));
    for (const taskId of movedIn) {
      if (present.has(taskId)) continue;
      // Видимость выборки — та же, что у `nodeTasks` (В1): конфиденциальные
      // задачи не попадают в агрегат ни у кого.
      const record = await this.record('task', taskId, undefined, tx, cache);
      if (!record || record.confidential) continue;
      kept.push(withOverride(record, override));
      present.add(taskId);
    }
    return kept;
  }
}

/** Подмена места (move-preview): дерево/узел задачи как после переноса. */
function withOverride(
  record: FormulaRecordData,
  override: FormulaPreviewOverride | undefined,
): FormulaRecordData {
  if (!override) return record;
  const nodeId = override.taskNode?.[record.id];
  const parentId = override.nodeParent?.[record.id];
  if (nodeId === undefined && parentId === undefined) return record;
  return {
    ...record,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(parentId === undefined ? {} : { parentId }),
  };
}
