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
  ) {}

  record(
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
      case 'project':
        return this.projects.project(id, tx);
      case 'node':
        return this.projects.node(id, tx);
    }
  }

  subtasks(taskId: string, tx?: TransactionClient): Promise<FormulaRecordData[]> {
    return this.tasks.subtasks(taskId, tx);
  }

  relatedTasks(
    taskId: string,
    relation: FormulaRelationKind,
    direction: FormulaRelationDirection,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]> {
    return this.tasks.relatedTasks(taskId, relation, direction, tx);
  }

  nodeTasks(nodeId: string, tx?: TransactionClient): Promise<FormulaRecordData[]> {
    return this.tasks.nodeTasks(nodeId, tx);
  }

  projectNodes(projectId: string, tx?: TransactionClient): Promise<FormulaRecordData[]> {
    return this.projects.projectNodes(projectId, tx);
  }
}
