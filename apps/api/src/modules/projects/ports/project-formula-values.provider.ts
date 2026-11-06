import { Injectable } from '@nestjs/common';
import type { CustomFieldValues } from '@nodus/contracts';
import type { FormulaValue } from '@nodus/formula-engine';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FormulaRecordData } from '../../custom-fields/ports/record-values.port.js';
import { NodeKindsRepository } from '../project-node-kinds.repository.js';
import { ProjectNodesRepository, type ProjectNodeRow } from '../project-nodes.repository.js';
import { ProjectsRepository, type ProjectRow } from '../projects.repository.js';
import type { ProjectFormulaValues } from './project-formula-values.port.js';

/**
 * Проекты и папки как источники формул (#632, Р6/Р7/Р11): значения атрибутов
 * и системные поля (`FORMULA_SYSTEM_FIELDS`: name/status/startDate/endDate/
 * manager у проекта, name/kind/createdAt у папки), место записи — тип проекта
 * и вид папки (формула привязки, Р6). Реализация живёт в projects (владелец
 * таблиц, I3); читается через репозитории модуля, не через Prisma напрямую.
 *
 * Видимость здесь не фильтруется: источники не выходят за проект хоста
 * (Р7 а–б), а хост уже проверен доступом. Секретный проект недоступен
 * формуле по построению — увидеть хост может только тот, кто видит проект.
 *
 * Архив проекта источником НЕ отсекается намеренно: архив обратим
 * (`project-lifecycle`: возврат снимает `archivedAt`), а ячейки проекта —
 * его же хост. Фильтр `archivedAt` в `record()` вернул бы null на чтении
 * хоста, и `FORMULA_CELLS.recalc` удалил бы ячейки проекта (null-контекст =
 * «смерть связей»): формулы терялись бы при архивации и не вернулись после
 * восстановления. Заморозка архива — про мутации (`ProjectFormulaService`),
 * не про существование записи.
 */
@Injectable()
export class ProjectFormulaValuesProvider implements ProjectFormulaValues {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly nodes: ProjectNodesRepository,
    private readonly kinds: NodeKindsRepository,
  ) {}

  async project(projectId: string, tx?: TransactionClient): Promise<FormulaRecordData | null> {
    const row = await this.projects.findById(projectId, tx);
    return row ? toProjectRecord(row) : null;
  }

  async node(nodeId: string, tx?: TransactionClient): Promise<FormulaRecordData | null> {
    const row = await this.nodes.findById(nodeId, tx);
    if (!row) return null;
    const kind = await this.kinds.findById(row.kindId, tx);
    return toNodeRecord(row, kind?.name ?? null);
  }

  /** Срез папок проекта: вид каждой папки — одной пачкой (О2: N+1 не нужен). */
  async projectNodes(projectId: string, tx?: TransactionClient): Promise<FormulaRecordData[]> {
    const rows = await this.nodes.listByProject(projectId, tx);
    if (rows.length === 0) return [];
    const kindNames = await this.kinds.namesByIds(
      rows.map((row) => row.kindId),
      tx,
    );
    return rows.map((row) => toNodeRecord(row, kindNames.get(row.kindId) ?? null));
  }
}

/** Проект-источник: системные поля в типах языка формул (Р2). */
function toProjectRecord(row: ProjectRow): FormulaRecordData {
  const system: Record<string, FormulaValue | undefined> = {
    name: row.name,
    status: row.status,
    startDate: isoDate(row.startedAt),
    endDate: isoDate(row.endsAt),
    manager: row.managerId,
  };
  return {
    kind: 'project',
    id: row.id,
    values: (row.customFields ?? {}) as CustomFieldValues,
    system,
    // Проект — сам себе дерево: источники `project` берут его же (Р7 б).
    projectId: row.id,
    parentId: null,
    nodeId: null,
    placeId: row.typeId,
    confidential: false,
  };
}

/** Папка-источник: вид — системное поле `kind` (Р6, формула привязки вида). */
function toNodeRecord(row: ProjectNodeRow, kindName: string | null): FormulaRecordData {
  const system: Record<string, FormulaValue | undefined> = {
    name: row.name,
    kind: kindName,
    createdAt: row.createdAt.toISOString(),
  };
  return {
    kind: 'node',
    id: row.id,
    values: (row.customFields ?? {}) as CustomFieldValues,
    system,
    projectId: row.projectId,
    parentId: row.parentId,
    nodeId: null,
    placeId: row.kindId,
    confidential: false,
  };
}

/** Дата языка формул — ISO-8601 (`date`: YYYY-MM-DD, I7). */
function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
