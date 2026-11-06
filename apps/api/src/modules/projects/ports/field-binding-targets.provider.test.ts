import { describe, expect, it, vi } from 'vitest';

import { FieldBindingTargetsProvider } from './field-binding-targets.provider.js';

/**
 * Порт целей привязки атрибутов в проектах (Р3 #631): оба справочника —
 * одним запросом каждый, по имени; архивность — из archivedAt (архивный
 * вид допустим в привязке: его формы живут).
 */

const PT = { id: 'pt-1', name: 'Договор', archivedAt: null };
const PT_ARCHIVED = { id: 'pt-2', name: 'Обследование', archivedAt: new Date('2026-10-01') };
const NK = { id: 'nk-1', name: 'Комплект', archivedAt: null };

function make() {
  const prisma = {
    projectType: { findMany: vi.fn(async () => [PT, PT_ARCHIVED]) },
    nodeKind: { findMany: vi.fn(async () => [NK]) },
  };
  const provider = new FieldBindingTargetsProvider(prisma as never);
  return { provider, prisma };
}

describe('FieldBindingTargetsProvider (Р3 #631)', () => {
  it('типы проектов — по имени asc, архивность из archivedAt', async () => {
    const { provider, prisma } = make();
    expect(await provider.projectTypes()).toEqual([
      { id: 'pt-1', name: 'Договор', archived: false },
      { id: 'pt-2', name: 'Обследование', archived: true },
    ]);
    expect(prisma.projectType.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, archivedAt: true },
      orderBy: { name: 'asc' },
    });
  });

  it('виды папок — тот же контракт; архивные включаются', async () => {
    const { provider, prisma } = make();
    expect(await provider.nodeKinds()).toEqual([{ id: 'nk-1', name: 'Комплект', archived: false }]);
    expect(prisma.nodeKind.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, archivedAt: true },
      orderBy: { name: 'asc' },
    });
  });
});
