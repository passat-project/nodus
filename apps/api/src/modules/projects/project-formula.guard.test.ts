import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AuthUser, type FormulaNode } from '@nodus/contracts';

import { ProjectFormulaService } from './project-formula.service.js';

/**
 * #705: гарды мутаций формул перепроверяются В ТРАНЗАКЦИИ по свежей строке
 * проекта под `FOR UPDATE` — архив/смена руководства между проверкой до tx и
 * замком не должны пропускать запись. Порядок замков: строка проекта →
 * структура → узел (без ABBA с обработчиками пересчёта).
 */

const PROJECT = '00000000-0000-4000-8000-000000000001';
const NODE = '00000000-0000-4000-8000-000000000002';
const MANAGER = '00000000-0000-4000-8000-0000000000a1';
const FIELD = '00000000-0000-4000-8000-0000000000f1';
const AST = { kind: 'literal', type: 'number', value: 42 } as unknown as FormulaNode;

const user: AuthUser = {
  id: MANAGER,
  email: 'u@nodus.by',
  displayName: 'u',
  permissions: [],
};

function make() {
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const projects = {
    loadForManage: vi.fn(async () => ({ row: { id: PROJECT, status: 'active' } })),
    assertManageLocked: vi.fn(async () => void 0),
  };
  const nodes = { findInProject: vi.fn(async () => ({ id: NODE })) };
  const writer = {
    lockProject: vi.fn(async () => ({ id: PROJECT, visibility: 'open', status: 'active' })),
    lockNode: vi.fn(async () => void 0),
    writeProject: vi.fn(async () => true),
    writeNode: vi.fn(async () => true),
  };
  const events = { emitChanged: vi.fn(async () => void 0) };
  const cells = {
    save: vi.fn(async () => ({ value: 42, error: null })),
    remove: vi.fn(async () => void 0),
    depthOf: vi.fn(async () => 0 as number | null),
  };
  const service = new ProjectFormulaService(
    txRunner as never,
    projects as never,
    nodes as never,
    writer as never,
    events as never,
    cells as never,
    {} as never,
  );
  return { service, projects, writer, cells };
}

describe('ProjectFormulaService: гарды под замком (#705)', () => {
  it('сохранение проекта: гард перепроверяется по свежей строке под FOR UPDATE', async () => {
    const { service, projects } = make();
    await service.save(user, PROJECT, FIELD, AST);
    expect(projects.assertManageLocked).toHaveBeenCalledWith(
      user,
      PROJECT,
      expect.objectContaining({ id: PROJECT, status: 'active' }),
      {},
    );
  });

  it('архив между гардом и транзакцией: формула проекта не пишется', async () => {
    const { service, projects, cells } = make();
    projects.assertManageLocked.mockRejectedValueOnce(
      Object.assign(new Error('Project is archived'), { code: ErrorCode.VALIDATION_FAILED }),
    );
    await expect(service.save(user, PROJECT, FIELD, AST)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(cells.save).not.toHaveBeenCalled();
  });

  it('снятие руководства между гардом и транзакцией: удаление формулы отклонено', async () => {
    const { service, projects, cells } = make();
    projects.assertManageLocked.mockRejectedValueOnce(
      Object.assign(new Error('forbidden'), { code: ErrorCode.FORBIDDEN }),
    );
    await expect(service.remove(user, PROJECT, FIELD)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(cells.remove).not.toHaveBeenCalled();
  });

  it('формула папки: строка проекта запирается до структуры и узла, архив запрещён', async () => {
    const { service, projects, writer } = make();
    await service.saveNode(user, PROJECT, NODE, FIELD, AST);
    expect(writer.lockProject.mock.invocationCallOrder[0]!).toBeLessThan(
      writer.lockNode.mock.invocationCallOrder[0]!,
    );
    expect(projects.assertManageLocked).toHaveBeenCalledWith(
      user,
      PROJECT,
      expect.objectContaining({ status: 'active' }),
      {},
      { archived: 'forbid' },
    );
  });

  it('архив между гардом и транзакцией: формула папки не пишется', async () => {
    const { service, projects, cells } = make();
    projects.assertManageLocked.mockRejectedValueOnce(
      Object.assign(new Error('Project is archived'), { code: ErrorCode.VALIDATION_FAILED }),
    );
    await expect(service.saveNode(user, PROJECT, NODE, FIELD, AST)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(cells.save).not.toHaveBeenCalled();
  });

  it('снятие формулы папки: строка проекта до структуры/узла, архив запрещён', async () => {
    const { service, projects, writer } = make();
    await service.removeNode(user, PROJECT, NODE, FIELD);
    expect(writer.lockProject.mock.invocationCallOrder[0]!).toBeLessThan(
      writer.lockNode.mock.invocationCallOrder[0]!,
    );
    expect(projects.assertManageLocked).toHaveBeenCalledWith(
      user,
      PROJECT,
      expect.objectContaining({ status: 'active' }),
      {},
      { archived: 'forbid' },
    );
  });

  it('архив между гардом и транзакцией: формула папки не снимается', async () => {
    const { service, projects, cells } = make();
    projects.assertManageLocked.mockRejectedValueOnce(
      Object.assign(new Error('Project is archived'), { code: ErrorCode.VALIDATION_FAILED }),
    );
    await expect(service.removeNode(user, PROJECT, NODE, FIELD)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(cells.remove).not.toHaveBeenCalled();
  });
});
