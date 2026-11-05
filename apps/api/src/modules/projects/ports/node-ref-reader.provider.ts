import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { NodeRefInfo, NodeRefReader } from './node-ref-reader.port.js';
import { PROJECT_READER, type ProjectActor, type ProjectReader } from './project-reader.port.js';

/**
 * Реализация read-порта узлов для ссылок атрибутов (Р5 #631): узел читается
 * из `project_nodes` (таблица модуля projects), видимость — через
 * существующий PROJECT_READER: проект узла обязан быть видим актёру
 * (открытый/участие/view_secret — критерий project-значений #52 Р13).
 */
@Injectable()
export class NodeRefReaderProvider implements NodeRefReader {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
  ) {}

  async refs(nodeIds: readonly string[]): Promise<NodeRefInfo[]> {
    if (nodeIds.length === 0) return [];
    const rows = await this.prisma.projectNode.findMany({
      where: { id: { in: [...nodeIds] } },
      select: { id: true, name: true },
    });
    return rows.map((row) => ({ id: row.id, name: row.name, deleted: false }));
  }

  async visibleFor(
    nodeId: string,
    viewer: { id: string; permissions: readonly string[] },
  ): Promise<boolean> {
    const node = await this.prisma.projectNode.findUnique({
      where: { id: nodeId },
      select: { projectId: true },
    });
    if (!node) return false;
    const actor: ProjectActor = viewer;
    const scope = await this.projects.viewScopeFor(actor);
    return scope.visibleProjectIds.includes(node.projectId);
  }
}
