import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, creationSlots } from '@nodus/contracts';

import { ProcessTypesService } from './process-types.service.js';

/** Библиотека типов процессов (#378, #428): уникальность имени, тип рождается
 *  скрытым, основа «копия типа» / «простой», системный тип не архивируется,
 *  категория неизменяема (основа — только того же вида). */

const USER = { id: 'u1', permissions: [] } as never;
const TX = { tx: true };

function setup(
  opts: {
    taken?: boolean;
    type?: Record<string, unknown> | null;
    rows?: Record<string, unknown>[];
    roles?: { id: string; code: string }[];
  } = {},
) {
  const repo = {
    findLiveByName: vi.fn(async () => (opts.taken ? { id: 'other' } : null)),
    maxSortOrder: vi.fn(async () => 5),
    createType: vi.fn(async (_tx: unknown, data: Record<string, unknown>) => ({
      id: 'new-type',
      isSystem: false,
      config: {},
      ...data,
    })),
    updateType: vi.fn(async () => void 0),
    updateConfig: vi.fn(async () => void 0),
    findById: vi.fn(async () =>
      opts.type === undefined
        ? { id: 't', name: 'A', category: 'task', code: 'custom-1', config: {} }
        : opts.type,
    ),
    list: vi.fn(async () => opts.rows ?? []),
    workflowMap: vi.fn(async () => new Map<string, string>()),
    creationMap: vi.fn(async () => new Map<string, unknown>()),
    seriesRefs: vi.fn(async () => []),
    attachToDefaultScheme: vi.fn(async () => void 0),
    createSimpleWorkflow: vi.fn(async () => 'wf-simple'),
    workflowIdOf: vi.fn(async () => 'wf-src'),
    copyWorkflow: vi.fn(async () => 'wf-copy'),
    copyTypeBindings: vi.fn(async () => void 0),
  };
  const workflows = {
    load: vi.fn(async () => ({ id: 'wf-src', stages: [], transitions: [] })),
    creationOf: vi.fn<() => Promise<unknown>>(async () => null),
  };
  const emit = vi.fn(async () => void 0);
  const membership = { effectiveRoles: vi.fn(async () => opts.roles ?? []) };
  const service = new ProcessTypesService(
    { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) } as never,
    repo as never,
    workflows as never,
    { has: vi.fn(() => true) } as never,
    { emit } as never,
    membership as never,
  );
  return { service, repo, workflows, emit, membership };
}

const body = (base: unknown, extra: Record<string, unknown> = {}) =>
  ({
    name: 'Задание сметчикам',
    category: 'task',
    icon: 'calculator',
    color: 'info',
    base,
    ...extra,
  }) as never;

describe('ProcessTypesService (#378)', () => {
  it('имя занято — PROCESS_TYPE_NAME_TAKEN, ничего не создаётся', async () => {
    const { service, repo } = setup({ taken: true });
    await expect(service.create(USER, body({ kind: 'simple' }))).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_NAME_TAKEN,
    });
    expect(repo.createType).not.toHaveBeenCalled();
  });

  it('создание: скрытый тип с серверным кодом, основа «простой», событие', async () => {
    const { service, repo, emit } = setup();
    const created = await service.create(USER, body({ kind: 'simple' }));
    expect(repo.createType).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ creatable: false, code: expect.stringMatching(/^custom-/) }),
    );
    expect(created).toMatchObject({ creatable: false, workflowId: 'wf-simple' });
    expect(repo.attachToDefaultScheme).toHaveBeenCalledWith(TX, 'new-type', 'wf-simple');
    expect(emit).toHaveBeenCalledWith(
      TX,
      'workflow.type_created',
      { typeId: 'new-type', name: 'Задание сметчикам', category: 'task' },
      expect.anything(),
    );
  });

  it('основа «копия типа»: маршрут и привязки атрибутов копируются новыми id', async () => {
    const { service, repo, workflows } = setup();
    const created = await service.create(USER, body({ kind: 'copy', typeId: 'src-type' }));
    expect(repo.workflowIdOf).toHaveBeenCalledWith('src-type');
    expect(workflows.load).toHaveBeenCalledWith('wf-src', TX);
    expect(created.workflowId).toBe('wf-copy');
    // Окна скопированного маршрута ссылаются на те же атрибуты (#432, Р8).
    expect(repo.copyTypeBindings).toHaveBeenCalledWith(TX, 'src-type', 'new-type');
  });

  it('основа — архивный тип: 404, ничего не создаётся', async () => {
    const { service, repo } = setup({
      type: { id: 'src-type', archivedAt: new Date(), category: 'task' },
    });
    await expect(
      service.create(USER, body({ kind: 'copy', typeId: 'src-type' })),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(repo.copyWorkflow).not.toHaveBeenCalled();
  });

  it('основа чужой категории: 404 (маршрут письма не основа задачи)', async () => {
    const { service, repo } = setup({ type: { id: 'src-type', category: 'letter' } });
    await expect(
      service.create(USER, body({ kind: 'copy', typeId: 'src-type' })),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(repo.copyWorkflow).not.toHaveBeenCalled();
  });

  it('категория без адаптера сущности — 409 CONFLICT', async () => {
    const { service, repo } = setup();
    const svc = service as unknown as { adapters: { has: (c: string) => boolean } };
    svc.adapters.has = () => false;
    await expect(
      service.create(USER, body({ kind: 'simple' }, { category: 'future', direction: 'incoming' })),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(repo.createType).not.toHaveBeenCalled();
  });

  it('каталог писем под замком: новый тип письма — 409 letter_catalog (#55, Р4)', async () => {
    const { service, repo } = setup();
    await expect(
      service.create(USER, body({ kind: 'simple' }, { category: 'letter', direction: 'incoming' })),
    ).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_SYSTEM_LOCKED,
      details: { reason: 'letter_catalog' },
    });
    expect(repo.createType).not.toHaveBeenCalled();
  });

  it('системный тип в архив нельзя — PROCESS_TYPE_SYSTEM_LOCKED', async () => {
    const { service, repo } = setup({ type: { id: 't', isSystem: true, category: 'task' } });
    await expect(service.setArchived(USER, 't', true)).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_SYSTEM_LOCKED,
    });
    expect(repo.updateType).not.toHaveBeenCalled();
  });

  it('правка свойств ставит customizedAt (каталог больше не трогает тип)', async () => {
    const { service, repo } = setup();
    await service.update(USER, 't', { creatable: true } as never);
    expect(repo.updateType).toHaveBeenCalledWith(
      TX,
      't',
      expect.objectContaining({ creatable: true, customizedAt: expect.any(Date) }),
    );
  });
});

describe('ProcessTypesService: конфигурация типа и доступ (#432)', () => {
  const ADMIN_ROLE = { id: '11111111-1111-4111-8111-111111111111', code: 'admin' };
  const OTHER_ROLE = '22222222-2222-4222-8222-222222222222';

  it('настройки типа сохраняются сразу и эмитят поля разделов', async () => {
    const { service, repo, emit } = setup();
    await service.updateConfig(USER, 't', {
      card: { hiddenBlocks: ['chat'], roleLabels: { creator: 'Заявитель' } },
    } as never);
    expect(repo.updateConfig).toHaveBeenCalledWith(
      TX,
      't',
      expect.objectContaining({ card: expect.objectContaining({ hiddenBlocks: ['chat'] }) }),
    );
    expect(emit).toHaveBeenCalledWith(
      TX,
      'workflow.type_updated',
      { typeId: 't', fields: ['config.card'] },
      expect.anything(),
    );
  });

  it('«Стандартный»: доступ не закрывается — 409 default_type', async () => {
    const { service, repo } = setup({
      type: { id: 't', name: 'Стандартный', code: 'task', category: 'task', config: {} },
    });
    await expect(
      service.updateConfig(USER, 't', { access: { view: ['r-1'], create: null } } as never),
    ).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_SYSTEM_LOCKED,
      details: { reason: 'default_type' },
    });
    expect(repo.updateConfig).not.toHaveBeenCalled();
  });

  it('«Стандартный»: выключить создание нельзя — 409', async () => {
    const { service } = setup({
      type: { id: 't', name: 'Стандартный', code: 'task', category: 'task', config: {} },
    });
    await expect(service.update(USER, 't', { creatable: false } as never)).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_SYSTEM_LOCKED,
    });
  });

  it('«Стандартный»: карточку менять можно (блоки — представление, не доступ)', async () => {
    const { service, repo } = setup({
      type: { id: 't', name: 'Стандартный', code: 'task', category: 'task', config: {} },
    });
    await service.updateConfig(USER, 't', {
      card: { hiddenBlocks: ['time'], roleLabels: {} },
    } as never);
    expect(repo.updateConfig).toHaveBeenCalled();
  });

  it('список: невидимый тип скрыт от сотрудника и виден администратору', async () => {
    const rows = [
      { id: 't-open', code: 'c1', name: 'Открытый', category: 'task', config: {}, creatable: true },
      {
        id: 't-closed',
        code: 'c2',
        name: 'Закрытый',
        category: 'task',
        config: { access: { view: [OTHER_ROLE], create: null } },
        creatable: true,
      },
    ];
    const employee = setup({ rows });
    const seen = await employee.service.list(USER, 'exclude');
    expect(seen.map((type) => type.id)).toEqual(['t-open']);
    expect(seen[0]!.viewer).toEqual({ canView: true, canCreate: true });

    const admin = setup({ rows, roles: [ADMIN_ROLE] });
    const all = await admin.service.list(
      { id: 'u1', permissions: ['workflow.manage'] } as never,
      'exclude',
    );
    expect(all.map((type) => type.id)).toEqual(['t-open', 't-closed']);
    expect(all[1]!.viewer).toEqual({ canView: true, canCreate: true });
  });

  it('DTO списка несёт опубликованную форму создания маршрута', async () => {
    const rows = [
      { id: 't-1', code: 'c1', name: 'Переработка', category: 'task', config: {}, creatable: true },
    ];
    const { service, repo, workflows } = setup({ rows });
    repo.workflowMap.mockResolvedValue(new Map([['t-1', 'wf-1']]));
    workflows.creationOf.mockResolvedValue({
      fields: [{ key: 'deadline', label: null, required: true, preset: null }],
      chips: [],
    });
    repo.creationMap.mockResolvedValue(
      new Map([
        [
          'wf-1',
          { fields: [{ key: 'deadline', label: null, required: true, preset: null }], chips: [] },
        ],
      ]),
    );
    const [type] = await service.list(USER, 'exclude');
    expect(type!.creationForm.fields).toEqual([
      { key: 'deadline', label: null, required: true, preset: null },
    ]);
  });
});

describe('ProcessTypesService: скрытые значения формы (#432, security)', () => {
  const rows = [
    { id: 't-1', code: 'c1', name: 'Переработка', category: 'task', config: {}, creatable: true },
  ];
  const form = {
    fields: [{ key: 'assignee', label: null, required: false, preset: 'user-secret' }],
    chips: [],
  };

  it('сотрудник без workflow.manage не видит значения пресетов, но поле остаётся скрытым', async () => {
    const { service, repo, workflows } = setup({ rows });
    repo.workflowMap.mockResolvedValue(new Map([['t-1', 'wf-1']]));
    repo.creationMap.mockResolvedValue(new Map([['wf-1', form]]));
    workflows.creationOf.mockResolvedValue(form);
    const [type] = await service.list(USER, 'exclude');
    const slot = creationSlots(type!.creationForm)[0]!;
    expect(slot.preset).toBe('');
    expect(slot.preset).not.toBeNull();
  });

  it('настройщик процессов видит настоящие значения', async () => {
    const { service, repo, workflows } = setup({ rows });
    repo.workflowMap.mockResolvedValue(new Map([['t-1', 'wf-1']]));
    repo.creationMap.mockResolvedValue(new Map([['wf-1', form]]));
    workflows.creationOf.mockResolvedValue(form);
    const [type] = await service.list(
      { id: 'u1', permissions: ['workflow.manage'] } as never,
      'exclude',
    );
    expect(creationSlots(type!.creationForm)[0]!.preset).toBe('user-secret');
  });
});
