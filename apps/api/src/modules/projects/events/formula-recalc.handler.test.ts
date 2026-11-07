import { describe, expect, it, vi } from 'vitest';

import {
  ProjectNodeFormulaRecalcHandler,
  ProjectTypeFormulaHandler,
} from './formula-recalc.handler.js';

/**
 * #632 (Р4/Р8): пересчёт формул по событиям хостов и каталога типов.
 * - `project.node_updated` двигает не только формулы папок, но и формулы
 *   ПРОЕКТОВ, читающих системные поля папки (`system:node:<id>`, A2-2);
 * - смена формы типа проекта (`project.type_changed`) меняет привязки
 *   атрибутов — ячейки проектов этого типа пересчитываются партиями (A2-3).
 */

const PROJECT = '63200000-0000-4000-8000-000000000601';
const OTHER_PROJECT = '63200000-0000-4000-8000-000000000602';
const NODE = '63200000-0000-4000-8000-000000000603';
const OTHER_NODE = '63200000-0000-4000-8000-000000000604';
const FIELD = '63200000-0000-4000-8000-000000000605';
const TYPE = '63200000-0000-4000-8000-000000000606';

const logger = () => ({ setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

function event(type: string, payload: Record<string, unknown>) {
  return { id: 'evt-1', type, actorId: null, payload, createdAt: '2026-11-06T00:00:00.000Z' };
}

function setupNodeHandler() {
  const formulas = {
    recalcNodeCells: vi.fn(async () => void 0),
    recalcNodes: vi.fn(async () => void 0),
    recalcProjectCells: vi.fn(async () => void 0),
  };
  const cells = {
    numberByDefinitionId: vi.fn(async () => null),
    depthOf: vi.fn(async () => 1),
    dependentCellsByDepKey: vi.fn(async () => [
      { cellId: 'c-project', hostKind: 'project', hostId: OTHER_PROJECT, fieldId: FIELD },
      { cellId: 'c-node', hostKind: 'node', hostId: OTHER_NODE, fieldId: FIELD },
      { cellId: 'c-self', hostKind: 'node', hostId: NODE, fieldId: FIELD },
    ]),
  };
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({}) };
  const handler = new ProjectNodeFormulaRecalcHandler(
    txRunner as never,
    formulas as never,
    cells as never,
    logger() as never,
  );
  return { handler, formulas, cells };
}

function setupTypeHandler(projectIds: string[]) {
  const formulas = { recalcProjectCells: vi.fn(async () => void 0) };
  const projects = { idsByType: vi.fn(async () => projectIds) };
  const txRunner = { run: vi.fn((fn: (tx: unknown) => unknown) => fn({})) };
  const handler = new ProjectTypeFormulaHandler(
    txRunner as never,
    formulas as never,
    projects as never,
    logger() as never,
  );
  return { handler, formulas, projects, txRunner };
}

describe('ProjectNodeFormulaRecalcHandler: project.node_updated (#632)', () => {
  it('проект-хост с зависимостью system:node:<id> пересчитывается (A2-2)', async () => {
    const { handler, formulas } = setupNodeHandler();
    await handler.handle(
      event('project.node_updated', { projectId: PROJECT, nodeId: NODE, fields: ['name'] }),
    );
    // Формула проекта читает системное поле папки через ref_field — значение
    // проекта не должно держать устаревший снимок.
    expect(formulas.recalcProjectCells).toHaveBeenCalledWith({}, null, OTHER_PROJECT, [], 1);
    // Папки-потребители — как раньше, без самого источника.
    expect(formulas.recalcNodes).toHaveBeenCalledWith({}, null, PROJECT, [OTHER_NODE], 1);
  });
});

describe('ProjectTypeFormulaHandler: project.type_changed (#632, A2-3)', () => {
  it('снятие слота с типа — ячейки проектов типа пересчитаны', async () => {
    const { handler, formulas, projects } = setupTypeHandler([PROJECT, OTHER_PROJECT]);
    await handler.handle(
      event('project.type_changed', { typeId: TYPE, change: 'updated', fields: ['form'] }),
    );
    expect(projects.idsByType).toHaveBeenCalledWith(TYPE);
    expect(formulas.recalcProjectCells).toHaveBeenCalledWith({}, null, PROJECT, [], 1);
    expect(formulas.recalcProjectCells).toHaveBeenCalledWith({}, null, OTHER_PROJECT, [], 1);
  });

  it('имя/значок/архив типа привязок не меняют — пересчёта нет', async () => {
    const { handler, formulas, projects } = setupTypeHandler([PROJECT]);
    await handler.handle(
      event('project.type_changed', { typeId: TYPE, change: 'archived', fields: ['archivedAt'] }),
    );
    expect(projects.idsByType).not.toHaveBeenCalled();
    expect(formulas.recalcProjectCells).not.toHaveBeenCalled();
  });

  it('новый тип — проектов ещё нет, пересчёта нет', async () => {
    const { handler, formulas, projects } = setupTypeHandler([PROJECT]);
    await handler.handle(
      event('project.type_changed', { typeId: TYPE, change: 'created', fields: ['form'] }),
    );
    expect(projects.idsByType).not.toHaveBeenCalled();
    expect(formulas.recalcProjectCells).not.toHaveBeenCalled();
  });

  it('партии по 100 проектов — своя транзакция на пачку', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `project-${index}`);
    const { handler, formulas, txRunner } = setupTypeHandler(ids);
    await handler.handle(
      event('project.type_changed', { typeId: TYPE, change: 'updated', fields: ['form'] }),
    );
    expect(txRunner.run).toHaveBeenCalledTimes(2);
    expect(formulas.recalcProjectCells).toHaveBeenCalledTimes(150);
  });
});
