import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { ProcessTypesService } from './process-types.service.js';

/** «Где создаётся» (#665): системным письмам разрешена только эта секция, и
 *  она не помечает тип настроенным (каталог продолжает получать ревизии). */

const USER = { id: 'u1', permissions: [] } as never;
const TX = { tx: true };
const LETTER = {
  id: 'l1',
  name: 'Входящее',
  code: 'letter-incoming',
  category: 'letter',
  direction: 'incoming',
  config: {},
};

function setup() {
  const repo = {
    findById: vi.fn(async () => LETTER),
    updateConfig: vi.fn(async () => void 0),
    workflowIdOf: vi.fn(async () => 'wf'),
    creationMap: vi.fn(async () => new Map<string, unknown>()),
    seriesRefs: vi.fn(async () => []),
  };
  const emit = vi.fn(async () => void 0);
  const service = new ProcessTypesService(
    { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) } as never,
    repo as never,
    {
      load: vi.fn(async () => ({ id: 'wf', stages: [], transitions: [] })),
      creationOf: vi.fn(async () => null),
    } as never,
    { has: vi.fn(() => true) } as never,
    { emit } as never,
    { effectiveRoles: vi.fn(async () => []) } as never,
    { liveProjectTypeIds: vi.fn(async () => []) } as never,
  );
  return { service, repo };
}

describe('ProcessTypesService: «где создаётся» у писем (#665)', () => {
  it('правится только creation и без customizedAt', async () => {
    const { service, repo } = setup();
    await service.updateConfig(USER, 'l1', {
      creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: true },
    } as never);
    expect(repo.updateConfig).toHaveBeenCalledWith(TX, 'l1', expect.anything(), {
      markCustomized: false,
    });
  });

  it('остальные разделы по-прежнему закрыты — 409 letter_catalog', async () => {
    const { service, repo } = setup();
    await expect(
      service.updateConfig(USER, 'l1', { card: { hiddenBlocks: [], roleLabels: {} } } as never),
    ).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_SYSTEM_LOCKED,
      details: { reason: 'letter_catalog' },
    });
    expect(repo.updateConfig).not.toHaveBeenCalled();
  });
});
