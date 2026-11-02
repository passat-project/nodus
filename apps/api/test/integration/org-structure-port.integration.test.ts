import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ORG_STRUCTURE_READER,
  type OrgStructureReader,
} from '../../src/core/ports/org-structure.port.js';
import { setupChatFixture } from './chat-fixtures.js';

/**
 * Порт решающих (#441, ADR-0025 §3) на живом стеке: держатели должности и
 * цепочка руководителей вверх (managerId → руководитель подразделения →
 * руководитель родительского), без циклов и самоссылки, глубина ограничена.
 */
describe('Порт оргструктуры: решающие (#441)', () => {
  let chat: Awaited<ReturnType<typeof setupChatFixture<'a' | 'b' | 'c' | 'd'>>>;
  let port: OrgStructureReader;
  const departmentIds: string[] = [];
  const positionIds: string[] = [];

  beforeAll(async () => {
    chat = await setupChatFixture(['a', 'b', 'c', 'd']);
    port = chat.app.get(ORG_STRUCTURE_READER);
  });

  afterAll(async () => {
    try {
      for (const id of [...departmentIds].reverse()) {
        await chat.prisma.department.delete({ where: { id } }).catch(() => undefined);
      }
      await chat.prisma.position.deleteMany({ where: { id: { in: positionIds } } });
    } finally {
      await chat.cleanup();
    }
  });

  const department = async (name: string, headId: string | null, parentId?: string) => {
    const created = await chat.prisma.department.create({
      data: {
        name: `${name} ${chat.runId}`,
        kind: 'management',
        headId,
        parentId,
      },
      select: { id: true },
    });
    departmentIds.push(created.id);
    return created.id;
  };

  it('holdersOfPosition: только активные держатели должности своего вида', async () => {
    const management = await chat.prisma.position.create({
      data: { name: `Позиция ${chat.runId}`, kind: 'management' },
      select: { id: true },
    });
    const legal = await chat.prisma.position.create({
      data: { name: `Юр. позиция ${chat.runId}`, kind: 'legal' },
      select: { id: true },
    });
    positionIds.push(management.id, legal.id);
    await chat.prisma.user.update({
      where: { id: chat.users.a.id },
      data: { positionId: management.id },
    });
    await chat.prisma.user.update({
      where: { id: chat.users.b.id },
      data: { legalPositionId: legal.id },
    });
    await chat.prisma.user.update({
      where: { id: chat.users.c.id },
      data: { positionId: management.id, status: 'deactivated' },
    });

    const holders = await port.holdersOfPosition(management.id);
    expect(holders.map((user) => user.id)).toEqual([chat.users.a.id]);

    const legalHolders = await port.holdersOfPosition(legal.id, 'legal');
    expect(legalHolders.map((user) => user.id)).toEqual([chat.users.b.id]);
  });

  it('managerChainOf: managerId → managerId (ближайший первым)', async () => {
    await chat.prisma.user.update({
      where: { id: chat.users.c.id },
      data: { status: 'active', managerId: null },
    });
    await chat.prisma.user.update({
      where: { id: chat.users.a.id },
      data: { managerId: chat.users.b.id },
    });
    await chat.prisma.user.update({
      where: { id: chat.users.b.id },
      data: { managerId: chat.users.c.id },
    });

    expect(await port.managerChainOf(chat.users.a.id)).toEqual([chat.users.b.id, chat.users.c.id]);
  });

  it('managerChainOf: без managerId — руководитель подразделения, затем родительского', async () => {
    const parent = await department('Родитель', chat.users.d.id);
    const child = await department('Дочернее', null, parent);
    await chat.prisma.user.update({
      where: { id: chat.users.a.id },
      data: { managerId: null, departmentId: child },
    });
    await chat.prisma.user.update({
      where: { id: chat.users.d.id },
      data: { departmentId: null, managerId: null },
    });

    // У ребёнка руководителя нет — поднимаемся к родительскому подразделению.
    expect(await port.managerChainOf(chat.users.a.id)).toEqual([chat.users.d.id]);
  });

  it('managerChainOf: цикл A↔B завершается, сам себе не руководитель', async () => {
    await chat.prisma.user.update({
      where: { id: chat.users.a.id },
      data: { managerId: chat.users.b.id, departmentId: null },
    });
    await chat.prisma.user.update({
      where: { id: chat.users.b.id },
      data: { managerId: chat.users.a.id },
    });

    expect(await port.managerChainOf(chat.users.a.id)).toEqual([chat.users.b.id]);
    expect(await port.managerChainOf(chat.users.b.id)).toEqual([chat.users.a.id]);
  });

  it('managerChainOf: руководитель собственного подразделения не попадает в свою цепочку', async () => {
    const dep = await department('Сам себе', chat.users.c.id);
    await chat.prisma.user.update({
      where: { id: chat.users.c.id },
      data: { managerId: null, departmentId: dep },
    });

    expect(await port.managerChainOf(chat.users.c.id)).toEqual([]);
  });

  it('managerChainOf: руководитель своего отдела поднимается к родительскому', async () => {
    const parent = await department('Верх', chat.users.d.id);
    const dep = await department('Свой отдел', chat.users.c.id, parent);
    await chat.prisma.user.update({
      where: { id: chat.users.c.id },
      data: { managerId: null, departmentId: dep },
    });
    await chat.prisma.user.update({
      where: { id: chat.users.d.id },
      data: { managerId: null, departmentId: null },
    });

    expect(await port.managerChainOf(chat.users.c.id)).toEqual([chat.users.d.id]);
  });

  it('managerChainOf: уволенный руководитель пропускается, шаг идёт выше', async () => {
    await chat.prisma.user.update({
      where: { id: chat.users.a.id },
      data: { managerId: chat.users.b.id, departmentId: null },
    });
    await chat.prisma.user.update({
      where: { id: chat.users.b.id },
      data: { managerId: chat.users.c.id, status: 'deactivated' },
    });
    await chat.prisma.user.update({
      where: { id: chat.users.c.id },
      data: { managerId: null, departmentId: null },
    });

    expect(await port.managerChainOf(chat.users.a.id)).toEqual([chat.users.c.id]);
  });
});
