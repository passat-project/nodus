import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

/** Минимальная строка узла для DTO и расчётов дерева. */
export const nodeSelect = {
  id: true,
  projectId: true,
  parentId: true,
  kindId: true,
  name: true,
  code: true,
  customFields: true,
  order: true,
  createdAt: true,
} as const;

export type ProjectNodeRow = Prisma.ProjectNodeGetPayload<{ select: typeof nodeSelect }>;

export interface NewProjectNode {
  projectId: string;
  parentId: string | null;
  kindId: string;
  name: string;
  order: string;
  customFields: Prisma.InputJsonValue;
}

export interface ProjectNodePatch {
  name?: string;
  code?: string | null;
  kindId?: string;
  customFields?: Prisma.InputJsonValue;
  parentId?: string | null;
  order?: string;
}

/**
 * Таблица `project_nodes` — узлы дерева проекта (#467): единственная точка
 * доступа модуля. Все мутации — под advisory-локом структуры проекта
 * (`lockStructure`), сериализующим проверки лимитов/циклов с записью.
 */
@Injectable()
export class ProjectNodesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Все узлы проекта по ключу порядка (≤ NODE_LIMITS.nodesPerProject). */
  listByProject(projectId: string, tx?: TransactionClient): Promise<ProjectNodeRow[]> {
    return (tx ?? this.prisma).projectNode.findMany({
      select: nodeSelect,
      where: { projectId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
  }

  async findById(id: string): Promise<ProjectNodeRow | null> {
    const row = await this.prisma.projectNode.findUnique({ select: nodeSelect, where: { id } });
    return row;
  }

  /** Узел проекта (без оракула чужих: не тот проект — null). Чтение под
   *  локом структуры идёт через `tx` (F2: иначе правка пишет поверх чужого
   *  изменения значений). */
  async findInProject(
    projectId: string,
    nodeId: string,
    tx?: TransactionClient,
  ): Promise<ProjectNodeRow | null> {
    const row = await (tx ?? this.prisma).projectNode.findFirst({
      select: nodeSelect,
      where: { id: nodeId, projectId },
    });
    return row;
  }

  countByProject(projectId: string, tx?: TransactionClient): Promise<number> {
    return (tx ?? this.prisma).projectNode.count({ where: { projectId } });
  }

  /** Шифр занят другим узлом проекта (зеркало частичного unique). */

  create(tx: TransactionClient, data: NewProjectNode): Promise<ProjectNodeRow> {
    return tx.projectNode.create({ select: nodeSelect, data: { id: randomUUID(), ...data } });
  }

  async update(tx: TransactionClient, id: string, patch: ProjectNodePatch): Promise<void> {
    await tx.projectNode.update({ where: { id }, data: patch });
  }

  async remove(tx: TransactionClient, id: string): Promise<void> {
    await tx.projectNode.delete({ where: { id } });
  }

  /** Очередь структуры проекта: advisory-лок до конца транзакции — проверки
   *  лимитов/циклов и запись не перекрещиваются между собой и batch. */
  async lockStructure(tx: TransactionClient, projectId: string): Promise<void> {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('nodus:project_nodes:' || ${projectId}::text))`,
    );
  }

  /** Уборка значений удалённого атрибута (#556, Р11): `custom_fields - key`
   *  только по строкам, где ключ ещё есть — повторная доставка события
   *  безвредна (идемпотентность). */
  async removeCustomFieldValues(tx: TransactionClient, fieldId: string): Promise<number> {
    return tx.$executeRaw(Prisma.sql`
      UPDATE project_nodes
      SET custom_fields = custom_fields - ${fieldId}::text
      WHERE custom_fields ? ${fieldId}::text
    `);
  }
}
