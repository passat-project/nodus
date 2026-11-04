import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, LetterTreeNode } from '@nodus/contracts';

import { LettersTreeService } from './letters-tree.service.js';

const USER = { id: 'u1', displayName: 'Сотрудник', permissions: [] } as unknown as AuthUser;

interface GraphNode {
  id: string;
  parent?: string;
  kind?: 'reply_to' | 'nested_in';
  /** Второй родитель (у письма бывает и конверт, и «ответ на»). */
  extraParents?: { id: string; kind?: 'reply_to' | 'nested_in' }[];
  confidential?: boolean;
  registered?: boolean;
}

const rowOf = (node: GraphNode) => ({
  id: node.id,
  regNumber: null,
  theirNumber: null,
  subject: `Письмо ${node.id}`,
  direction: 'incoming',
  systemState: 'active',
  confidential: node.confidential ?? false,
  registeredAt: node.registered === false ? null : new Date('2026-10-01T08:00:00.000Z'),
  registrarId: 'u-registrar',
  addresseeId: null,
  deletedAt: null,
});

function setup(graph: GraphNode[], visibleIds: string[] = graph.map((node) => node.id)) {
  const byId = new Map(graph.map((node) => [node.id, node]));
  const repo = {
    nodesByIds: vi.fn(async (ids: readonly string[]) =>
      ids.filter((id) => byId.has(id)).map((id) => rowOf(byId.get(id)!)),
    ),
    participantsOf: vi.fn(async () => []),
  };
  const relations = {
    parentLinks: vi.fn(async (ids: readonly string[]) =>
      ids.flatMap((id) => {
        const node = byId.get(id);
        if (!node) return [];
        return [
          ...(node.parent
            ? [{ letterId: id, relatedLetterId: node.parent, kind: node.kind ?? 'reply_to' }]
            : []),
          ...(node.extraParents ?? []).map((parent) => ({
            letterId: id,
            relatedLetterId: parent.id,
            kind: parent.kind ?? 'reply_to',
          })),
        ];
      }),
    ),
    childLinks: vi.fn(async (ids: readonly string[]) =>
      graph
        .filter((node) => node.parent && ids.includes(node.parent))
        .map((node) => ({
          id: `rel-${node.id}`,
          letterId: node.id,
          relatedLetterId: node.parent!,
          kind: node.kind ?? 'reply_to',
        })),
    ),
  };
  const query = {
    visibleRow: vi.fn(async (_user: unknown, id: string) => {
      const node = byId.get(id);
      if (!node || !visibleIds.includes(id)) throw Object.assign(new Error('nf'), { status: 404 });
      return rowOf(node);
    }),
  };
  const service = new LettersTreeService(repo as never, relations as never, query as never);
  return { service, repo, relations };
}

const ids = (nodes: LetterTreeNode[]): string[] => nodes.map((node) => node.id);

describe('дерево «ёлочки» (#461, Р2)', () => {
  it('корень — верх цепочки; дети обоих видов; узел несёт связь с родителем', async () => {
    const { service } = setup([
      { id: 'A' },
      { id: 'B', parent: 'A', kind: 'reply_to' },
      { id: 'C', parent: 'B', kind: 'nested_in' },
    ]);
    const tree = await service.tree(USER, 'C');
    expect(tree.root.id).toBe('A');
    expect(ids(tree.root.children)).toEqual(['B']);
    expect(tree.root.children[0]?.relationKind).toBe('reply_to');
    expect(ids(tree.root.children[0]!.children)).toEqual(['C']);
    expect(tree.root.children[0]!.children[0]?.relationKind).toBe('nested_in');
    expect(tree.truncated).toBe(false);
  });

  it('невидимый промежуточный узел скрывает поддерево целиком', async () => {
    const { service } = setup(
      [
        { id: 'A' },
        { id: 'B', parent: 'A' },
        { id: 'C', parent: 'B' },
        { id: 'D', parent: 'A', confidential: true },
        { id: 'E', parent: 'D' },
      ],
      ['A', 'B', 'C'],
    );
    const tree = await service.tree(USER, 'A');
    expect(ids(tree.root.children)).toEqual(['B']);
    expect(JSON.stringify(tree)).not.toContain('"D"');
    expect(JSON.stringify(tree)).not.toContain('"E"');
  });

  it('линейная цепочка ответов не урезается: 12 писем — один ствол', async () => {
    // Модель «цепочка + ветки» (ред. 05.11.2026): единственный ответ
    // продолжает цепочку на том же уровне — глубина не растёт.
    const chain: GraphNode[] = [{ id: 'n0' }];
    for (let index = 1; index <= 12; index += 1) {
      chain.push({ id: `n${index}`, parent: `n${index - 1}` });
    }
    const { service } = setup(chain);
    const tree = await service.tree(USER, 'n0');
    let count = 1;
    let node: LetterTreeNode | undefined = tree.root;
    while (node?.children[0]) {
      count += 1;
      node = node.children[0];
    }
    expect(count).toBe(13);
    expect(tree.truncated).toBe(false);
  });

  it('глубина ветвления/матрёшки режется капом 8 — truncated', async () => {
    const chain: GraphNode[] = [{ id: 'n0' }];
    for (let index = 1; index <= 12; index += 1) {
      chain.push({ id: `n${index}`, parent: `n${index - 1}`, kind: 'nested_in' });
    }
    const { service } = setup(chain);
    const tree = await service.tree(USER, 'n0');
    let depth = 0;
    let node: LetterTreeNode | undefined = tree.root;
    while (node?.children[0]) {
      depth += 1;
      node = node.children[0];
    }
    expect(depth).toBe(8);
    expect(tree.truncated).toBe(true);
  });

  it('кап узлов 200 — лишние не строятся, truncated', async () => {
    const graph: GraphNode[] = [{ id: 'root' }];
    for (let index = 0; index < 205; index += 1) {
      graph.push({ id: `c${index}`, parent: 'root' });
    }
    const { service } = setup(graph);
    const tree = await service.tree(USER, 'root');
    expect(tree.root.children).toHaveLength(200);
    expect(tree.truncated).toBe(true);
  });

  it('невидимый конверт не рвёт подъём: пробуем видимого родителя второго вида', async () => {
    // X лежит в конфиденциальном конверте Env (невидим зрителю) и отвечает
    // на видимое Root: цепочку Root ← X зритель видеть может — её и строим.
    const { service } = setup(
      [
        { id: 'Root' },
        { id: 'Env', confidential: true },
        {
          id: 'X',
          parent: 'Root',
          kind: 'reply_to',
          extraParents: [{ id: 'Env', kind: 'nested_in' }],
        },
      ],
      ['Root', 'X'],
    );
    const tree = await service.tree(USER, 'X');
    expect(tree.root.id).toBe('Root');
    expect(ids(tree.root.children)).toEqual(['X']);
  });

  it('корень-невидимое письмо — 404 (visibleRow)', async () => {
    const { service } = setup([{ id: 'A', confidential: true }], []);
    await expect(service.tree(USER, 'A')).rejects.toMatchObject({ status: 404 });
  });
});
