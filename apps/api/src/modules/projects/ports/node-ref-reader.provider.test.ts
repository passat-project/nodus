import { describe, expect, it, vi } from 'vitest';

import { NodeRefReaderProvider } from './node-ref-reader.provider.js';

/**
 * Read-порт узлов для ссылок атрибутов (Р5 #631): узел читается из
 * `project_nodes`, видимость — через PROJECT_READER: проект узла обязан
 * быть видим актёру (критерий project-значений #52 Р13).
 */

const N1 = '00000000-0000-4000-8000-000000000401';
const N2 = '00000000-0000-4000-8000-000000000402';
const P1 = '00000000-0000-4000-8000-000000000411';
const P2 = '00000000-0000-4000-8000-000000000412';

function make(
  rows: { id: string; name: string }[],
  nodes: { id: string; projectId: string }[],
  visible: string[],
) {
  const prisma = {
    projectNode: {
      // `refs` выбирает id+name, `visibleForMany` — id+projectId (#641).
      findMany: vi.fn(async (args: { select?: { projectId?: boolean } }) =>
        args?.select?.projectId ? nodes : rows,
      ),
    },
  };
  const scope = () => ({ visibleProjectIds: visible, hiddenProjectIds: [] });
  const projects = {
    viewScopeFor: vi.fn(async () => scope()),
    freshViewScopeFor: vi.fn(async () => scope()),
  };
  const provider = new NodeRefReaderProvider(prisma as never, projects as never);
  return { provider, prisma, projects };
}

describe('NodeRefReaderProvider.refs (Р5 #631)', () => {
  it('пустой список — без запроса; узлы не архивируются — deleted всегда false', async () => {
    const { provider, prisma } = make([], [], []);
    expect(await provider.refs([])).toEqual([]);
    expect(prisma.projectNode.findMany).not.toHaveBeenCalled();

    const withRows = make(
      [
        { id: N1, name: 'Раздел 1' },
        { id: N2, name: 'Комплект 2' },
      ],
      [],
      [],
    );
    expect(await withRows.provider.refs([N1, N2])).toEqual([
      { id: N1, name: 'Раздел 1', deleted: false },
      { id: N2, name: 'Комплект 2', deleted: false },
    ]);
  });
});

describe('NodeRefReaderProvider.visibleFor (Р5 #631, #52 Р13)', () => {
  const viewer = { id: 'u1', permissions: [] };

  it('узла нет — false без вопроса о проектах', async () => {
    const { provider, projects } = make([], [], []);
    expect(await provider.visibleFor(N1, viewer)).toBe(false);
    expect(projects.viewScopeFor).not.toHaveBeenCalled();
  });

  it('видимость узла = видимость его проекта (открытый/участие)', async () => {
    const visible = make([], [{ id: N1, projectId: P1 }], [P1]);
    expect(await visible.provider.visibleFor(N1, viewer)).toBe(true);

    const secret = make([], [{ id: N1, projectId: P2 }], [P1]);
    expect(await secret.provider.visibleFor(N1, viewer)).toBe(false);
    expect(secret.projects.viewScopeFor).toHaveBeenCalledWith(viewer);
  });

  it('батч (#641): один запрос узлов и один расчёт scope на пачку', async () => {
    const { provider, prisma, projects } = make(
      [],
      [
        { id: N1, projectId: P1 },
        { id: N2, projectId: P2 },
      ],
      [P1],
    );
    const result = await provider.visibleForMany([N1, N2], viewer);
    expect([...result]).toEqual([N1]);
    expect(prisma.projectNode.findMany).toHaveBeenCalledTimes(1);
    expect(projects.viewScopeFor).toHaveBeenCalledTimes(1);
  });

  it('путь записи (#646): fresh — scope без TTL-кэша', async () => {
    const { provider, projects } = make([], [{ id: N1, projectId: P1 }], [P1]);
    expect([...(await provider.visibleForMany([N1], viewer, { fresh: true }))]).toEqual([N1]);
    expect(projects.freshViewScopeFor).toHaveBeenCalledWith(viewer);
    expect(projects.viewScopeFor).not.toHaveBeenCalled();
  });
});
