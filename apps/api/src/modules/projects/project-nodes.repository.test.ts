import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../../generated/prisma/client.js';
import { ProjectNodesRepository } from './project-nodes.repository.js';

/**
 * Локи записи узла (#646): advisory-лок структуры сериализует PATCH между
 * собой, но bulk-уборка значений удалённого атрибута идёт под другим ключом
 * (`nodus:node_kinds`) — от воскрешения ключа защищает строковый `FOR UPDATE`.
 */

const PROJECT = '00000000-0000-4000-8000-0000000000a1';
const NODE = '00000000-0000-4000-8000-0000000000a2';

function make() {
  const tx = { $executeRaw: vi.fn(async () => 1) };
  const repo = new ProjectNodesRepository({} as never);
  return { repo, tx };
}

/** Текст SQL из параметра Prisma.sql (строки + значения шаблона). */
function sqlText(call: unknown[]): string {
  const query = call[0] as Prisma.Sql;
  return query.strings.join('?');
}

describe('ProjectNodesRepository: локи узла (#646)', () => {
  it('lockNode берёт строковый FOR UPDATE по узлу проекта', async () => {
    const { repo, tx } = make();
    await repo.lockNode(tx as never, PROJECT, NODE);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const text = sqlText(tx.$executeRaw.mock.calls[0] as unknown[]);
    expect(text).toMatch(/project_nodes/);
    expect(text).toMatch(/FOR UPDATE/);
    expect(text).toMatch(/project_id/);
  });

  it('lockStructure берёт advisory-лок очереди структуры проекта', async () => {
    const { repo, tx } = make();
    await repo.lockStructure(tx as never, PROJECT);
    const text = sqlText(tx.$executeRaw.mock.calls[0] as unknown[]);
    expect(text).toMatch(/pg_advisory_xact_lock/);
    expect(text).toMatch(/nodus:project_nodes:/);
  });
});
