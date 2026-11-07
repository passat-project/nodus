import { Inject, Injectable } from '@nestjs/common';
import type {
  FormulaHostKind,
  FormulaRelationDirection,
  FormulaRelationKind,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  LETTER_FORMULA_VALUES,
  type LetterFormulaValues,
} from '../../correspondence/ports/letter-formula-values.port.js';
import {
  PROJECT_FORMULA_VALUES,
  type ProjectFormulaValues,
} from '../../projects/ports/project-formula-values.port.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import {
  TASK_FORMULA_VALUES,
  type TaskFormulaValues,
} from '../../tasks/ports/task-formula-values.port.js';
import type {
  FormulaRecordData,
  RecordReadOptions,
  RecordValuesReader,
} from './record-values.port.js';

/**
 * Композиция портов владельцев в один резолвер-контракт (#632, Р11):
 * custom-fields не знает, в каком модуле живёт запись, — он знает вид
 * носителя. Фильтрация видимости остаётся в модулях-владельцах (I3/Р7).
 */
@Injectable()
export class RecordValuesProvider implements RecordValuesReader {
  constructor(
    @Inject(TASK_FORMULA_VALUES) private readonly tasks: TaskFormulaValues,
    @Inject(PROJECT_FORMULA_VALUES) private readonly projects: ProjectFormulaValues,
    @Inject(LETTER_FORMULA_VALUES) private readonly letters: LetterFormulaValues,
    @Inject(PROJECT_READER) private readonly projectsReader: ProjectReader,
  ) {}

  async record(
    kind: FormulaHostKind,
    id: string,
    opts?: RecordReadOptions,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData | null> {
    switch (kind) {
      case 'task':
        return this.tasks.record(id, opts, tx);
      case 'letter':
        return this.letters.record(id, opts, tx);
      case 'project': {
        // Секретный проект не виден актору — 404 без оракула (Р7).
        if (opts?.actor) {
          const refs = await this.projectsReader.refsFor(opts.actor, [id]);
          if (refs.length === 0) return null;
        }
        return this.projects.project(id, tx);
      }
      case 'node': {
        const node = await this.projects.node(id, tx);
        if (opts?.actor && node?.projectId) {
          const refs = await this.projectsReader.refsFor(opts.actor, [node.projectId]);
          if (refs.length === 0) return null;
        }
        return node;
      }
    }
  }

  subtasks(
    taskId: string,
    opts?: RecordReadOptions,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]> {
    return this.tasks.subtasks(taskId, opts, tx);
  }

  relatedTasks(
    taskId: string,
    relation: FormulaRelationKind,
    direction: FormulaRelationDirection,
    opts?: RecordReadOptions,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]> {
    return this.tasks.relatedTasks(taskId, relation, direction, opts, tx);
  }

  nodeTasks(
    nodeId: string,
    projectId: string | null,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]> {
    return this.tasks.nodeTasks(nodeId, projectId, tx);
  }

  projectNodes(projectId: string, tx?: TransactionClient): Promise<FormulaRecordData[]> {
    return this.projects.projectNodes(projectId, tx);
  }
}
