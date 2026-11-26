import { describe, expect, it } from 'vitest';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';

import { defaultProcessesSurface, resolveProcessesSurface } from './resolve-surface.js';

const PT = (id: string, patch: Partial<ProjectType> = {}) =>
  ({
    id,
    name: `Тип ${id}`,
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds: null,
    archivedAt: null,
    ...patch,
  }) as unknown as ProjectType;
const T = (id: string, patch: Partial<ProcessType> = {}) =>
  ({ id, category: 'task', archivedAt: null, ...patch }) as unknown as ProcessType;
const K = (id: string, patch: Partial<NodeKind> = {}) =>
  ({
    id,
    name: `Папка ${id}`,
    icon: 'folder',
    color: 'blue',
    archivedAt: null,
    ...patch,
  }) as unknown as NodeKind;

const data = (patch: Partial<Parameters<typeof resolveProcessesSurface>[1]> = {}) => ({
  processTypes: [T('task-1')],
  projectTypes: [PT('proj-1')],
  kinds: [K('kind-1')],
  canSetup: true,
  ...patch,
});

describe('URL-модель единого входа «Процессы» (#857)', () => {
  it('приоритет ftype > type > ptype > noproject', () => {
    expect(resolveProcessesSurface({ ftype: 'kind-1' }, data()).surface).toBe('folder');
    expect(
      resolveProcessesSurface({ ftype: 'kind-1', type: 'task-1', ptype: 'proj-1' }, data()).surface,
    ).toBe('folder');
    expect(resolveProcessesSurface({ type: 'task-1', ptype: 'proj-1' }, data())).toEqual({
      surface: 'type',
      typeId: 'task-1',
      trailTypeId: 'proj-1',
    });
    expect(resolveProcessesSurface({ ptype: 'proj-1', noproject: '1' }, data()).surface).toBe(
      'project',
    );
    expect(resolveProcessesSurface({ noproject: '1' }, data()).surface).toBe('no-project');
  });

  it('deep-link ?noproject=1: разбор адреса даёт ЧИСЛО 1, строка — из navigate', () => {
    // TanStack Router читает search-параметры с JSON-семантикой: `1` в адресе
    // приходит числом, а `go({ noproject: '1' })` пишет строку — оба валидны.
    expect(resolveProcessesSurface({ noproject: 1 }, data()).surface).toBe('no-project');
    expect(resolveProcessesSurface({ noproject: '1' }, data()).surface).toBe('no-project');
    expect(resolveProcessesSurface({ noproject: 0 }, data()).surface).toBe('project');
    expect(resolveProcessesSurface({ noproject: '0' }, data()).surface).toBe('project');
  });

  it('умолчание — первая живая строка «Проектов», без неё — первый живой тип задач', () => {
    expect(defaultProcessesSurface(data())).toEqual({ surface: 'project', typeId: 'proj-1' });
    expect(defaultProcessesSurface(data({ canSetup: false }))).toEqual({
      surface: 'type',
      typeId: 'task-1',
      trailTypeId: null,
    });
    expect(
      defaultProcessesSurface(
        data({ canSetup: false, processTypes: [T('a', { archivedAt: new Date().toISOString() })] }),
      ),
    ).toEqual({ surface: 'empty' });
  });

  it('без права настройки проектные ссылки игнорируются', () => {
    expect(resolveProcessesSurface({ ftype: 'kind-1' }, data({ canSetup: false }))).toEqual({
      surface: 'type',
      typeId: 'task-1',
      trailTypeId: null,
    });
    expect(resolveProcessesSurface({ ptype: 'proj-1' }, data({ canSetup: false }))).toEqual({
      surface: 'type',
      typeId: 'task-1',
      trailTypeId: null,
    });
  });

  it('выбранный id пропал (архив) — откат к умолчанию', () => {
    const archived = PT('proj-1', { archivedAt: new Date().toISOString() });
    expect(
      resolveProcessesSurface({ ptype: 'proj-1' }, data({ projectTypes: [archived] })),
    ).toEqual({ surface: 'type', typeId: 'task-1', trailTypeId: null });
    const archivedTask = T('task-1', { archivedAt: new Date().toISOString() });
    expect(
      resolveProcessesSurface({ type: 'task-1' }, data({ processTypes: [archivedTask] })),
    ).toEqual({ surface: 'project', typeId: 'proj-1' });
    // Тип папки-архив открывается (внизу экрана «Вернуть»), чужой id — нет.
    expect(resolveProcessesSurface({ ftype: 'kind-x' }, data())).toEqual({
      surface: 'project',
      typeId: 'proj-1',
    });
  });

  it('дорожка: ptype валиден только вместе с живым типом проекта', () => {
    expect(resolveProcessesSurface({ type: 'task-1', ptype: 'proj-x' }, data())).toEqual({
      surface: 'type',
      typeId: 'task-1',
      trailTypeId: null,
    });
    expect(
      resolveProcessesSurface({ type: 'task-1', ptype: 'proj-1' }, data({ canSetup: false })),
    ).toEqual({ surface: 'type', typeId: 'task-1', trailTypeId: null });
  });
});
