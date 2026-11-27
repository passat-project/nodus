import { describe, expect, it } from 'vitest';
import type { CreateSavedViewBody } from '@nodus/contracts';

import { resolveLevel } from './saved-views.repository.js';

const body = (patch: Partial<CreateSavedViewBody>): CreateSavedViewBody => ({
  name: 'Вид',
  entity: 'task',
  scope: { kind: 'journal' },
  filter: [],
  sort: [],
  totals: [],
  columns: [],
  ...patch,
});

describe('уровень настройки из рамки (#435)', () => {
  it('журнал — только личная; тип — только type_default', () => {
    expect(resolveLevel(body({ scope: { kind: 'journal' } }))).toBe('personal');
    expect(
      resolveLevel(
        body({ scope: { kind: 'type_default', typeId: '00000000-0000-4000-8000-000000000001' } }),
      ),
    ).toBe('type_default');
  });

  it('проект: умолчание — личная (безопаснее правами), явная — общая', () => {
    const scope = { kind: 'project', projectId: '00000000-0000-4000-8000-000000000002' } as const;
    expect(resolveLevel(body({ scope }))).toBe('personal');
    expect(resolveLevel(body({ scope, level: 'project' }))).toBe('project');
    expect(resolveLevel(body({ scope, level: 'personal' }))).toBe('personal');
  });
});
