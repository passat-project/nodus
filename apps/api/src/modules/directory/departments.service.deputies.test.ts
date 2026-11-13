import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AuthUser } from '@nodus/contracts';

import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { DepartmentsService } from './departments.service.js';

/**
 * Заместители подразделения (#817): их НЕСКОЛЬКО на узел, порядок — `sort_order`,
 * дубли отсекаются. Заместитель — только ДЕЙСТВУЮЩИЙ сотрудник: уволенный не
 * отдаётся ни в дереве, ни в карточке, ни в форме, и назначить его нельзя.
 * Строка связи уволенного остаётся историей в БД и наружу не выходит.
 */

const actor = (permissions: string[] = []): AuthUser => ({
  id: 'admin-1',
  email: 'a@b.by',
  displayName: 'Админ',
  permissions,
});

function row(
  id: string,
  parentId: string | null,
  name = id,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    kind: 'management',
    parentId,
    headId: null,
    sortOrder: 0,
    isActive: true,
    head: null,
    deputies: [],
    _count: { members: 0 },
    ...overrides,
  };
}

const deputy = (
  userId: string,
  sortOrder: number,
  displayName: string,
  status: 'active' | 'deactivated' = 'active',
) => ({
  userId,
  sortOrder,
  user: { displayName, status },
});

describe('DepartmentsService: заместители подразделения (#817)', () => {
  const departments = {
    findAllByKind: vi.fn(),
    findById: vi.fn(),
    lockForUpdate: vi.fn(),
    lockTree: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setDeputies: vi.fn(),
    findParentChain: vi.fn(),
    findSubtreeIds: vi.fn(),
    findRef: vi.fn(),
    countActiveChildren: vi.fn(),
  };
  const users = { findActiveIdsByDepartmentIds: vi.fn(), findRef: vi.fn(), findRefs: vi.fn() };
  const positions = { findRef: vi.fn() };
  const roles = { permissionsByIds: vi.fn(), lockForUpdate: vi.fn(), lockByCodeForUpdate: vi.fn() };
  const membership = { effectiveRoleIds: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: DepartmentsService;

  beforeEach(() => {
    vi.resetAllMocks();
    membership.effectiveRoleIds.mockResolvedValue([]);
    departments.lockForUpdate.mockResolvedValue(true);
    const guard = new RoleAssignmentGuard(roles as never, membership as never);
    const references = new ReferenceGuard(users as never, departments as never, positions as never);
    service = new DepartmentsService(
      departments as never,
      users as never,
      guard,
      references,
      tx as never,
      eventBus as never,
    );
  });

  it('дерево: отдаются только ДЕЙСТВУЮЩИЕ заместители, в порядке связи', async () => {
    departments.findAllByKind.mockResolvedValue([
      row('root', null, 'Отдел', {
        deputies: [
          deputy('deputy-1', 0, 'Первый Зам'),
          // Уволенный: строка связи ещё в БД, но наружу не идёт.
          deputy('deputy-old', 1, 'Уволенный Зам', 'deactivated'),
          deputy('deputy-2', 2, 'Второй Зам'),
        ],
      }),
    ]);

    const tree = await service.getTree('management');

    expect(tree[0]!.deputyIds).toEqual(['deputy-1', 'deputy-2']);
    expect(tree[0]!.deputies).toEqual([
      { id: 'deputy-1', displayName: 'Первый Зам' },
      { id: 'deputy-2', displayName: 'Второй Зам' },
    ]);
  });

  it('карточка подразделения: уволенный заместитель не отдаётся', async () => {
    departments.findById.mockResolvedValue(
      row('dep', null, 'Отдел', {
        deputies: [
          deputy('deputy-1', 0, 'Действующий Зам'),
          deputy('deputy-old', 1, 'Уволенный Зам', 'deactivated'),
        ],
      }),
    );

    const node = await service.getById('dep');

    expect(node.deputyIds).toEqual(['deputy-1']);
    expect(node.deputies.map((entry) => entry.displayName)).toEqual(['Действующий Зам']);
  });

  it('создание: дубли отсечены, порядок сохранён, ответ — по связи', async () => {
    users.findRefs.mockResolvedValue([
      { id: 'u-1', status: 'active' },
      { id: 'u-2', status: 'active' },
    ]);
    departments.create.mockResolvedValue(row('dep-1', null, 'Новый отдел'));
    departments.findById.mockResolvedValue(
      row('dep-1', null, 'Новый отдел', {
        deputies: [deputy('u-1', 0, 'Первый'), deputy('u-2', 1, 'Второй')],
      }),
    );

    const node = await service.create(
      {
        name: 'Новый отдел',
        kind: 'management',
        parentId: null,
        headId: null,
        deputyIds: ['u-1', 'u-2', 'u-1'],
        sortOrder: 0,
      },
      'admin-1',
    );

    expect(users.findRefs).toHaveBeenCalledWith(['u-1', 'u-2'], 'tx-handle');
    expect(departments.setDeputies).toHaveBeenCalledWith('dep-1', ['u-1', 'u-2'], 'tx-handle');
    expect(node.deputyIds).toEqual(['u-1', 'u-2']);
    expect(node.deputies.map((entry) => entry.displayName)).toEqual(['Первый', 'Второй']);
  });

  it('создание с уволенным заместителем → 400 inactive, узла нет', async () => {
    users.findRefs.mockResolvedValue([{ id: 'u-1', status: 'deactivated' }]);

    await expect(
      service.create(
        {
          name: 'Новый отдел',
          kind: 'management',
          parentId: null,
          headId: null,
          deputyIds: ['u-1'],
          sortOrder: 0,
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_REFERENCE_INVALID,
      details: { field: 'deputyIds', reason: 'inactive' },
    });
    expect(departments.create).not.toHaveBeenCalled();
  });

  it('правка: только НОВЫЕ заместители проверяются на активность', async () => {
    departments.findById
      .mockResolvedValueOnce(row('dep', null))
      .mockResolvedValueOnce(
        row('dep', null, 'Отдел', { deputies: [deputy('deputy-1', 0, 'Старый Зам')] }),
      );
    departments.update.mockResolvedValue(
      row('dep', null, 'Отдел', {
        deputies: [deputy('deputy-1', 0, 'Старый Зам'), deputy('deputy-2', 1, 'Новый Зам')],
      }),
    );
    users.findRefs.mockResolvedValue([{ id: 'deputy-2', status: 'active' }]);

    const node = await service.update('dep', { deputyIds: ['deputy-1', 'deputy-2'] }, actor());

    expect(users.findRefs).toHaveBeenCalledWith(['deputy-2'], 'tx-handle');
    expect(departments.setDeputies).toHaveBeenCalledWith(
      'dep',
      ['deputy-1', 'deputy-2'],
      'tx-handle',
    );
    expect(node.deputyIds).toEqual(['deputy-1', 'deputy-2']);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.department.updated',
      { departmentId: 'dep', changedFields: ['deputyIds'] },
      expect.objectContaining({ actorId: 'admin-1' }),
    );
  });

  it('правка с неактивным НОВЫМ заместителем → 400, записи нет', async () => {
    departments.findById.mockResolvedValue(row('dep', null));
    users.findRefs.mockResolvedValue([{ id: 'u-1', status: 'deactivated' }]);

    await expect(service.update('dep', { deputyIds: ['u-1'] }, actor())).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_REFERENCE_INVALID,
      details: { field: 'deputyIds', reason: 'inactive' },
    });
    expect(departments.update).not.toHaveBeenCalled();
    expect(departments.setDeputies).not.toHaveBeenCalled();
  });

  it('уволенный со старой строкой связи — НЕ «уже назначенный»: вернуть нельзя (#817)', async () => {
    const deputies = [deputy('deputy-old', 0, 'Уволенный Зам', 'deactivated')];
    departments.findById.mockResolvedValue(row('dep', null, 'Отдел', { deputies }));
    users.findRefs.mockResolvedValue([{ id: 'deputy-old', status: 'deactivated' }]);

    // Скрытый из выдачи человек с оставшейся строкой связи не должен
    // проходить как «уже назначенный» — это новое назначение уволенного.
    await expect(
      service.update('dep', { deputyIds: ['deputy-old'] }, actor()),
    ).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_REFERENCE_INVALID,
      details: { field: 'deputyIds', reason: 'inactive' },
    });
    expect(departments.update).not.toHaveBeenCalled();
    expect(departments.setDeputies).not.toHaveBeenCalled();
  });

  it('пустой набор снимает всех заместителей (и вычищает строки истории)', async () => {
    departments.findById.mockResolvedValueOnce(
      row('dep', null, 'Отдел', {
        deputies: [
          deputy('deputy-1', 0, 'Зам'),
          deputy('deputy-old', 1, 'Уволенный Зам', 'deactivated'),
        ],
      }),
    );
    departments.findById.mockResolvedValue(row('dep', null));
    departments.update.mockResolvedValue(row('dep', null));

    const node = await service.update('dep', { deputyIds: [] }, actor());

    expect(users.findRefs).not.toHaveBeenCalled();
    expect(departments.setDeputies).toHaveBeenCalledWith('dep', [], 'tx-handle');
    expect(node.deputyIds).toEqual([]);
  });

  it('правка без deputyIds набор не трогает (уволенный остаётся историей в БД)', async () => {
    const deputies = [
      deputy('deputy-1', 0, 'Зам'),
      deputy('deputy-old', 1, 'Уволенный Зам', 'deactivated'),
    ];
    departments.findById.mockResolvedValue(row('dep', null, 'Отдел', { deputies }));
    departments.update.mockResolvedValue(row('dep', null, 'Новое имя', { deputies }));

    const node = await service.update('dep', { name: 'Новое имя' }, actor());

    expect(departments.setDeputies).not.toHaveBeenCalled();
    expect(node.deputyIds).toEqual(['deputy-1']);
  });
});
