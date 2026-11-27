import { Inject, Injectable } from '@nestjs/common';
import type { ConditionSubject, CustomFieldType } from '@nodus/contracts';
import { customFieldIdOfKey } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import {
  PROJECT_FORMULA_VALUES,
  type ProjectFormulaValues,
} from '../../projects/ports/project-formula-values.port.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import {
  LETTER_FORMULA_VALUES,
  type LetterFormulaValues,
} from '../../correspondence/ports/letter-formula-values.port.js';
import {
  TASK_FORMULA_VALUES,
  type TaskFormulaValues,
} from '../../tasks/ports/task-formula-values.port.js';
import { CUSTOM_FIELD_REGISTRY, type CustomFieldRegistry } from './custom-field-registry.port.js';
import {
  capSelection,
  singleSelection,
  type ConditionHost,
  type ConditionRecordData,
  type ConditionRecordsReader,
  type ConditionSelection,
} from './condition-records.port.js';

/** Типы атрибутов-ссылок → вид записи-цели (ref_field, #635). */
const REF_FIELD_KINDS: Partial<Record<CustomFieldType, 'task' | 'letter' | 'project' | 'node'>> = {
  task: 'task',
  letter: 'letter',
  project: 'project',
  node: 'node',
};

/**
 * Композиция портов владельцев в читателя общей выборки (#635): субъект
 * условия (подзадачи, связи, задачи папки/проекта, папки проекта, проект,
 * записи по ссылке) превращается в запросы к владельцам данных (I3);
 * полный состав выборок дают владельцы, custom-fields семантики не знает.
 * Папки типа (`folder_type_tasks`) досчитываются здесь: папки проекта
 * фильтруются по виду, задачи читаются по каждой папке.
 */
@Injectable()
export class ConditionRecordsProvider implements ConditionRecordsReader {
  constructor(
    @Inject(TASK_FORMULA_VALUES) private readonly tasks: TaskFormulaValues,
    @Inject(PROJECT_FORMULA_VALUES) private readonly projects: ProjectFormulaValues,
    @Inject(LETTER_FORMULA_VALUES) private readonly letters: LetterFormulaValues,
    @Inject(PROJECT_READER) private readonly projectsReader: ProjectReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly registry: CustomFieldRegistry,
  ) {}

  async selection(
    host: ConditionHost,
    subject: ConditionSubject,
    tx?: TransactionClient,
  ): Promise<ConditionSelection> {
    const hostRow = await this.hostRow(host, tx);
    if (!hostRow) return capSelection([]);
    switch (subject.kind) {
      case 'self':
        return singleSelection([hostRow]);
      case 'parent_task':
        return host.kind === 'task' && hostRow.parentId !== null
          ? await this.tasks.conditionTasks({ kind: 'one', id: hostRow.parentId }, tx)
          : capSelection([]);
      case 'subtasks':
        return host.kind === 'task'
          ? await this.tasks.conditionTasks({ kind: 'subtasks_of', taskId: host.id }, tx)
          : capSelection([]);
      case 'relations':
        return host.kind === 'task'
          ? await this.tasks.conditionTasks(
              {
                kind: 'related_of',
                taskId: host.id,
                relation: subject.relation,
                direction: subject.direction,
              },
              tx,
            )
          : capSelection([]);
      case 'folder_tasks':
        return host.kind === 'task' && hostRow.nodeId !== null
          ? await this.tasks.conditionTasks(
              { kind: 'node_tasks', nodeId: hostRow.nodeId, projectId: hostRow.projectId },
              tx,
            )
          : capSelection([]);
      case 'project_tasks':
        return hostRow.projectId !== null
          ? await this.tasks.conditionTasks(
              { kind: 'project_tasks', projectId: hostRow.projectId },
              tx,
            )
          : capSelection([]);
      case 'project_folders': {
        if (hostRow.projectId === null) return capSelection([]);
        const nodes = await this.projects.conditionNodes(hostRow.projectId, tx);
        // Фильтр по виду сужает множество, но переполнение «все папки»
        // всё равно переполняет выборку — потолок честный (fail-closed).
        const filtered = subject.folderTypeId
          ? nodes.records.filter((node) => node.typeId === subject.folderTypeId)
          : nodes.records;
        return { records: filtered, overflowed: nodes.overflowed };
      }
      case 'folder_type_tasks': {
        if (hostRow.projectId === null) return capSelection([]);
        const nodes = await this.projects.conditionNodes(hostRow.projectId, tx);
        const folders = nodes.records
          .filter((node) => node.typeId === subject.folderTypeId)
          .map((node) => node.id);
        // Один запрос по всем папкам вида с общим потолком (#635): N+1 по
        // папкам выносил потолок из request-пути.
        const tasks = await this.tasks.conditionTasks(
          { kind: 'nodes_tasks', nodeIds: folders, projectId: hostRow.projectId },
          tx,
        );
        return { records: tasks.records, overflowed: nodes.overflowed || tasks.overflowed };
      }
      case 'project': {
        if (hostRow.projectId === null) return capSelection([]);
        const project = await this.projects.conditionProject(hostRow.projectId, tx);
        return singleSelection(project ? [project] : []);
      }
      case 'ref_field':
        return this.refFieldRecords(hostRow, subject.field, tx);
    }
  }

  async visibleOf(
    records: readonly ConditionRecordData[],
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<ReadonlySet<string>> {
    const visible = new Set<string>();
    const idsOf = (kind: ConditionRecordData['kind']): string[] =>
      records.filter((record) => record.kind === kind).map((record) => record.id);
    const taskIds = idsOf('task');
    if (taskIds.length > 0) {
      for (const id of await this.tasks.visibleTaskIds(taskIds, actor, tx)) visible.add(id);
    }
    const letterIds = idsOf('letter');
    if (letterIds.length > 0) {
      for (const id of await this.letters.visibleLetterIds(letterIds, actor, tx)) visible.add(id);
    }
    // Проект и папка видны актору через видимость их проекта (секретные —
    // только участие/view_secret, тот же ридер, что у карточки проекта).
    const projectIds = new Set<string>();
    for (const record of records) {
      if (record.kind === 'project') projectIds.add(record.id);
      if (record.kind === 'node' && record.projectId !== null) projectIds.add(record.projectId);
    }
    if (projectIds.size > 0) {
      const refs = await this.projectsReader.refsFor(actor, [...projectIds]);
      const visibleProjects = new Set(refs.map((ref) => ref.id));
      for (const record of records) {
        if (record.kind === 'project' && visibleProjects.has(record.id)) visible.add(record.id);
        if (
          record.kind === 'node' &&
          record.projectId !== null &&
          visibleProjects.has(record.projectId)
        ) {
          visible.add(record.id);
        }
      }
    }
    return visible;
  }

  private async hostRow(
    host: ConditionHost,
    tx?: TransactionClient,
  ): Promise<ConditionRecordData | null> {
    if (host.kind === 'task') {
      const { records } = await this.tasks.conditionTasks({ kind: 'one', id: host.id }, tx);
      return records[0] ?? null;
    }
    return this.letters.conditionLetter(host.id, tx);
  }

  /** Записи по ссылке из поля-ссылки (#635): вид цели — тип атрибута,
   *  значение — uuid; пустое/несовместимое поле — пустая выборка. Значение
   *  одно — выборка единичная, потолка не превышает. */
  private async refFieldRecords(
    hostRow: ConditionRecordData,
    field: string,
    tx?: TransactionClient,
  ): Promise<ConditionSelection> {
    const fieldId = customFieldIdOfKey(field);
    if (fieldId === null) return capSelection([]);
    const definitions = await this.registry.definitions({}, tx);
    const definition = definitions.find((entry) => entry.id === fieldId);
    if (!definition) return capSelection([]);
    const targetKind = REF_FIELD_KINDS[definition.type];
    if (!targetKind) return capSelection([]);
    const value = hostRow.values[fieldId];
    if (typeof value !== 'string') return capSelection([]);
    switch (targetKind) {
      case 'task':
        return this.tasks.conditionTasks({ kind: 'ids', ids: [value] }, tx);
      case 'letter': {
        const letter = await this.letters.conditionLetter(value, tx);
        return singleSelection(letter ? [letter] : []);
      }
      case 'project':
      case 'node':
        return singleSelection(await this.projects.conditionRecords(targetKind, [value], tx));
    }
  }
}
