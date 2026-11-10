import { describe, expect, it } from 'vitest';

import { DuplicateTaskSourceError } from './tasks.repository.js';
import { ACTIVE, CLOSED_INITIAL, STAGE, TX, USER, setup } from './tasks.service.test-helper.js';

describe('TasksService', () => {
  it('«В задачу»: параллельный клик проиграл unique-дедупу — задача победителя, не 409', async () => {
    const { service, repo } = setup();
    repo.findLiveIdBySource.mockResolvedValueOnce(null).mockResolvedValueOnce('winner');
    repo.create.mockRejectedValueOnce(new DuplicateTaskSourceError());
    const item = await service.create(USER, {
      title: 'Из чата',
      sourceMessageId: '00000000-0000-4000-8000-000000000001',
    } as never);
    expect(item).toEqual({ id: 'winner' });
    expect(repo.findLiveIdBySource).toHaveBeenLastCalledWith(
      'alice',
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('дубль без живого победителя (удалён) — ошибка не глотается', async () => {
    const { service, repo } = setup();
    repo.create.mockRejectedValueOnce(new DuplicateTaskSourceError());
    await expect(
      service.create(USER, { title: 'Из чата', sourceMessageId: 'm1' } as never),
    ).rejects.toBeInstanceOf(DuplicateTaskSourceError);
  });

  it('обычное создание: ключ начала колонки, стартовый чек-лист, размещения', async () => {
    const { service, repo, placements, placementsRepo, engine } = setup();
    await service.create(USER, {
      title: 'Т',
      checklist: ['a'],
      personalStageId: 'p-new',
    } as never);
    expect(repo.stageKeyAt).toHaveBeenCalledWith(TX, 's-new', 0);
    expect(repo.create.mock.calls[0]![0]).toMatchObject({ stageOrder: 'a0', checklistTotal: 1 });
    expect(placements.prepare).toHaveBeenCalledWith(['alice']);
    expect(placements.sync).toHaveBeenCalled();
    expect(placementsRepo.move).toHaveBeenCalledWith(TX, {
      taskId: 't1',
      userId: 'alice',
      stageId: 'p-new',
      sortOrder: 'k0',
    });
    expect(engine.execute).not.toHaveBeenCalled();
  });

  it('создание в колонке «В работе» — переход в той же транзакции (#402)', async () => {
    const { service, repo, boards, catalog, engine, placementsRepo } = setup();
    catalog.liveStages.mockResolvedValue([STAGE, ACTIVE]);
    boards.findColumn.mockResolvedValue({ id: 'p-active', systemState: 'active', outcome: null });
    await service.create(USER, { title: 'Т', personalStageId: 'p-active' } as never);
    // Строка рождается в начальной стадии, цель колонки — переходом.
    expect(repo.create.mock.calls[0]![0]).toMatchObject({
      stageId: 's-new',
      systemState: 'backlog',
    });
    expect(engine.execute).toHaveBeenCalledWith(
      TX,
      't1',
      'task',
      USER,
      { systemState: 'active', outcome: null },
      { confirmEmptyNumberParts: undefined },
    );
    expect(placementsRepo.move).toHaveBeenCalledWith(TX, {
      taskId: 't1',
      userId: 'alice',
      stageId: 'p-active',
      sortOrder: 'k0',
    });
  });

  it('закрытая «начальная» стадия не создаёт закрытую задачу — берётся открытая (#402)', async () => {
    const { service, repo, catalog } = setup();
    catalog.liveStages.mockResolvedValue([CLOSED_INITIAL, STAGE, ACTIVE]);
    await service.create(USER, { title: 'Т' } as never);
    expect(repo.create.mock.calls[0]![0]).toMatchObject({
      stageId: 's-new',
      systemState: 'backlog',
    });
  });

  it('колонка без стадии маршрута — 409, задача не создаётся (#402)', async () => {
    const { service, repo, boards } = setup();
    boards.findColumn.mockResolvedValue({ id: 'p-paused', systemState: 'paused', outcome: null });
    await expect(
      service.create(USER, { title: 'Т', personalStageId: 'p-paused' } as never),
    ).rejects.toMatchObject({ code: 'WORKFLOW_TRANSITION_NOT_ALLOWED' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('явный stageId передаётся движку как стадия, даже если состояние совпадает (#402)', async () => {
    const { service, repo, catalog, engine } = setup();
    const secondBacklog = {
      id: 's-new-2',
      name: 'Вторая',
      color: 'neutral',
      sortOrder: 1,
      systemState: 'backlog',
      outcome: null,
      isInitial: false,
      archivedAt: null,
    };
    catalog.liveStages.mockResolvedValue([STAGE, secondBacklog]);
    engine.execute.mockResolvedValueOnce({ stage: secondBacklog, recordId: 'rec-1' } as never);
    await service.create(USER, { title: 'Т', stageId: 's-new-2' } as never);
    expect(repo.create.mock.calls[0]![0]).toMatchObject({ stageId: 's-new' });
    expect(engine.execute).toHaveBeenCalledWith(
      TX,
      't1',
      'task',
      USER,
      { stageId: 's-new-2' },
      { confirmEmptyNumberParts: undefined },
    );
  });

  it('явный stageId: движок ушёл в другую стадию — NOT_ALLOWED', async () => {
    const { service, catalog } = setup();
    const secondBacklog = {
      id: 's-new-2',
      name: 'Вторая',
      color: 'neutral',
      sortOrder: 1,
      systemState: 'backlog',
      outcome: null,
      isInitial: false,
      archivedAt: null,
    };
    catalog.liveStages.mockResolvedValue([STAGE, secondBacklog]);
    await expect(
      service.create(USER, { title: 'Т', stageId: 's-new-2' } as never),
    ).rejects.toMatchObject({ code: 'WORKFLOW_TRANSITION_NOT_ALLOWED' });
  });

  it('тип резолвится портом «Процессов» с актором: явный выбор — с проверкой создания', async () => {
    const { service, catalog } = setup();
    await service.create(USER, { title: 'Т' } as never);
    expect(catalog.resolveType).toHaveBeenCalledWith(undefined, {
      category: 'task',
      requireCreatable: false,
      actorId: 'alice',
    });
    await service.create(USER, { title: 'Т', typeId: 'type' } as never);
    expect(catalog.resolveType).toHaveBeenCalledWith('type', {
      category: 'task',
      requireCreatable: true,
      actorId: 'alice',
    });
  });

  it('удаление: дети — к ближайшему ЖИВОМУ предку под очередью дерева', async () => {
    const { service, repo, placementsRepo, press } = setup();
    await service.remove({ ...USER, id: 'alice' }, 't1');
    expect(repo.lockTree).toHaveBeenCalledWith(TX);
    expect(repo.liveAncestorId).toHaveBeenCalledWith(TX, 't1');
    expect(repo.reparentChildren).toHaveBeenCalledWith(TX, 't1', 'grand');
    expect(placementsRepo.removeAllForTask).toHaveBeenCalledWith(TX, 't1');
    expect(press.cancelForTask).toHaveBeenCalledWith(TX, 't1');
    expect(repo.lockTree.mock.invocationCallOrder[0]).toBeLessThan(
      repo.liveAncestorId.mock.invocationCallOrder[0]!,
    );
  });
});
