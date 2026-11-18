import { describe, expect, it, vi } from 'vitest';

import { ProjectReaderProvider } from './project-reader.provider.js';

/** «Место создания» (#665): тип проекта и вид папки для серверных проверок. */
describe('ProjectReaderProvider — место создания (#665)', () => {
  const actor = { id: 'u-1', permissions: [] };

  it('projectTypeOf: тип проекта и имя; выключенный модуль — null', async () => {
    const projects = {
      findById: vi.fn(async () => ({
        typeId: 'pt-1',
        type: { id: 'pt-1', name: 'Договор' },
      })),
    };
    const provider = new ProjectReaderProvider(
      projects as never,
      { rolesByProject: vi.fn(), userIdsBySources: vi.fn() } as never,
      { findById: vi.fn() } as never,
      { isEnabled: vi.fn(async () => true) } as never,
      { get: vi.fn() } as never,
    );
    expect(await provider.projectTypeOf('p-1')).toEqual({ id: 'pt-1', name: 'Договор' });

    const disabled = new ProjectReaderProvider(
      projects as never,
      { rolesByProject: vi.fn(), userIdsBySources: vi.fn() } as never,
      { findById: vi.fn() } as never,
      { isEnabled: vi.fn(async () => false) } as never,
      { get: vi.fn() } as never,
    );
    expect(await disabled.projectTypeOf('p-1')).toBeNull();
  });

  it('nodeKindOf: вид папки только своего проекта', async () => {
    const nodes = {
      findById: vi.fn(async (id: string) =>
        id === 'n-1'
          ? { id: 'n-1', projectId: 'p-1', kindId: 'k-1' }
          : { id, projectId: 'p-2', kindId: 'k-2' },
      ),
    };
    const provider = new ProjectReaderProvider(
      { findById: vi.fn() } as never,
      { rolesByProject: vi.fn(), userIdsBySources: vi.fn() } as never,
      nodes as never,
      { isEnabled: vi.fn(async () => true) } as never,
      { get: vi.fn() } as never,
    );
    expect(await provider.nodeKindOf('p-1', 'n-1')).toBe('k-1');
    expect(await provider.nodeKindOf('p-1', 'n-2')).toBeNull();
    expect(actor.permissions).toEqual([]);
  });
});
