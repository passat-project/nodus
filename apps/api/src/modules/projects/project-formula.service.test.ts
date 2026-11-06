import { describe, expect, it, vi } from 'vitest';
import { CUSTOM_FIELD_EVENTS, ErrorCode, type AuthUser, type FormulaNode } from '@nodus/contracts';

import { ProjectFormulaEvents } from './project-formula-events.js';
import { ProjectFormulaService } from './project-formula.service.js';

/**
 * Формула ячейки проекта и папки (#632, Р4/Р10): значение материализует
 * писатель модуля, `custom_field.formula_changed` уезжает адресно аудитории
 * проекта (O4); права мутаций — как у правки полей (архив — заморозка).
 */

const PROJECT = '00000000-0000-4000-8000-000000000001';
const NODE = '00000000-0000-4000-8000-000000000002';
const MANAGER = '00000000-0000-4000-8000-0000000000a1';
const ASSISTANT = '00000000-0000-4000-8000-0000000000a2';
const FIELD = '00000000-0000-4000-8000-0000000000f1';
const AST = { kind: 'literal', type: 'number', value: 42 } as unknown as FormulaNode;

const user: AuthUser = {
  id: MANAGER,
  email: 'u@nodus.by',
  displayName: 'u',
  permissions: [],
};

/** Итог вычисления формулы (значение материализует писатель, Р4). */
interface Computation {
  value: number | null;
  error: { code: string; message: string } | null;
}

function make() {
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const projects = {
    assertVisible: vi.fn(async () => ({ id: PROJECT })),
    loadForManage: vi.fn(async () => ({ row: { id: PROJECT, status: 'active' } })),
  };
  const repo = {
    findById: vi.fn(async () => ({ id: PROJECT, managerId: MANAGER, assistantIds: [ASSISTANT] })),
  };
  const nodes = { findInProject: vi.fn(async () => ({ id: NODE })) };
  const writer = { writeProject: vi.fn(async () => true), writeNode: vi.fn(async () => true) };
  const participants = { rowsOfProject: vi.fn(async () => [{ userId: 'u-participant' }]) };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const cells = {
    save: vi.fn<(tx?: unknown, args?: unknown) => Promise<Computation>>(async () => ({
      value: 42,
      error: null,
    })),
    remove: vi.fn(async () => void 0),
    read: vi.fn(async () => ({ ast: null, origin: null })),
  };
  const events = new ProjectFormulaEvents(repo as never, participants as never, eventBus as never);
  const service = new ProjectFormulaService(
    txRunner as never,
    projects as never,
    nodes as never,
    writer as never,
    events,
    cells as never,
  );
  return { service, projects, writer, participants, eventBus, cells };
}

describe('ProjectFormulaService (#632, Р10)', () => {
  it('сохранение формулы проекта: значение — писателем, событие — аудитории проекта', async () => {
    const { service, writer, eventBus, participants } = make();
    expect(await service.save(user, PROJECT, FIELD, AST)).toEqual({ ast: AST, origin: 'own' });
    expect(writer.writeProject).toHaveBeenCalledWith(
      expect.anything(),
      MANAGER,
      PROJECT,
      FIELD,
      42,
    );
    expect(participants.rowsOfProject).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      {
        hostKind: 'project',
        hostId: PROJECT,
        fieldId: FIELD,
        hasError: false,
        audience: expect.arrayContaining([MANAGER, ASSISTANT, 'u-participant']),
      },
      expect.objectContaining({ aggregateType: 'project', aggregateId: PROJECT }),
    );
  });

  it('ошибка вычисления: значение пишется (пустое), hasError=true', async () => {
    const { service, cells, eventBus } = make();
    cells.save.mockResolvedValueOnce({
      value: null,
      error: { code: 'division_by_zero', message: 'x' },
    });
    await service.save(user, PROJECT, FIELD, AST);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      expect.objectContaining({ hasError: true }),
      expect.anything(),
    );
  });

  it('архивный проект без project.manage — 403 на мутации формулы', async () => {
    const { service, projects, cells } = make();
    projects.loadForManage.mockResolvedValueOnce({ row: { id: PROJECT, status: 'archived' } });
    await expect(service.save(user, PROJECT, FIELD, AST)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(cells.save).not.toHaveBeenCalled();
  });

  it('папка: значение пишется писателем узла, событие — адресное (hostKind node)', async () => {
    const { service, writer, eventBus } = make();
    await service.saveNode(user, PROJECT, NODE, FIELD, AST);
    expect(writer.writeNode).toHaveBeenCalledWith(
      expect.anything(),
      MANAGER,
      PROJECT,
      NODE,
      FIELD,
      42,
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      expect.objectContaining({ hostKind: 'node', hostId: NODE }),
      expect.objectContaining({ aggregateType: 'project_node', aggregateId: NODE }),
    );
  });
});
