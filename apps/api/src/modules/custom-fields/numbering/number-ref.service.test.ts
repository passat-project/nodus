import { describe, expect, it, vi } from 'vitest';
import type { NumberContainer } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { NumberRefService } from './number-ref.service.js';

const TX = {} as TransactionClient;
const ACTOR = { id: 'actor', permissions: [] };

function setup(opts: { ref?: unknown; typeRefs?: unknown[]; hydrated?: unknown[] } = {}) {
  const definitions = {
    list: vi.fn(async () => [{ id: 'def-7', number: 7, type: 'text', name: 'Инв. №' }]),
  };
  const targets = {
    nodeKinds: vi.fn(async () => [{ id: 'kind-1', name: 'Комплект' }]),
    projectTypes: vi.fn(async () => [{ id: 'pt-1', name: 'Проект' }]),
  };
  const catalog = {
    typeRefs: vi.fn(async () => opts.typeRefs ?? [{ id: 'type-1', name: 'Тип' }]),
  };
  const hosts = {
    resolveRef: vi.fn(async () => opts.ref ?? null),
  };
  const hydrator = {
    hydrateMany: vi.fn(async () => opts.hydrated ?? [{ id: 'def-7', name: 'Значение' }]),
  };
  const service = new NumberRefService(
    definitions as never,
    targets as never,
    catalog as never,
    hosts as never,
    hydrator as never,
  );
  return { service, definitions, targets, catalog, hosts, hydrator };
}

const containers: NumberContainer[] = [
  { kind: 'folder', nodeKindId: 'kind-1' },
  { kind: 'project' },
  { kind: 'portfolio' },
  { kind: 'parent_task' },
  { kind: 'project_type' },
  { kind: 'record_type' },
  { kind: 'field', fieldNumber: 7 },
];

describe('NumberRefService (#630): значения условий глазами человека', () => {
  it('все виды: имена, пути, скрытые и удалённые', async () => {
    const { service } = setup({
      ref: {
        entity: 'node',
        id: 'n',
        name: 'КЖ-01',
        path: ['Проект'],
        hidden: false,
        deleted: false,
      },
    });
    const refs = await service.refs(
      TX,
      [
        { entity: 'node', id: 'n' },
        { entity: 'project', id: 'p' },
        { entity: 'portfolio', id: 'pf' },
        { entity: 'task', id: 't' },
        { entity: 'project_type', id: 'pt-1' },
        { entity: 'type', id: 'type-1' },
        { entity: 'value', id: 'v' },
      ],
      containers,
      ACTOR,
    );
    expect(refs).toHaveLength(7);
    expect(refs[0]).toMatchObject({ name: 'КЖ-01', path: ['Проект'] });
    expect(refs[4]).toMatchObject({ name: 'Проект', deleted: false });
    expect(refs[5]).toMatchObject({ name: 'Тип', deleted: false });
    expect(refs[6]).toMatchObject({ name: 'Значение', deleted: false });
  });

  it('нет записи — заглушка «удалено»; неизвестный тип и значение', async () => {
    const { service } = setup({ ref: null, typeRefs: [], hydrated: [] });
    const refs = await service.refs(
      TX,
      [
        { entity: 'task', id: 't' },
        { entity: 'project_type', id: 'gone' },
        { entity: 'type', id: 'gone' },
        { entity: 'value', id: 'v' },
      ],
      [
        { kind: 'parent_task' },
        { kind: 'project_type' },
        { kind: 'record_type' },
        { kind: 'field', fieldNumber: 7 },
      ],
      ACTOR,
    );
    expect(refs[0]).toMatchObject({ name: 'Задача', deleted: true });
    expect(refs[1]).toMatchObject({ name: 'Тип проекта', deleted: true });
    expect(refs[2]).toMatchObject({ name: 'Тип записи', deleted: true });
    expect(refs[3]).toMatchObject({ name: 'Значение', deleted: true });
  });

  it('значение без определения — «Значение», скрытая запись не раскрывается', async () => {
    const { service, hydrator } = setup({
      ref: { entity: 'node', id: 'n', name: 'Скрытая', path: [], hidden: true, deleted: false },
    });
    const refs = await service.refs(
      TX,
      [
        { entity: 'node', id: 'n' },
        { entity: 'value', id: 'v' },
      ],
      [{ kind: 'folder', nodeKindId: 'kind-1' }, { kind: 'project' }],
      ACTOR,
    );
    expect(refs[0]).toMatchObject({ name: 'Скрытая', hidden: true });
    expect(refs[1]).toMatchObject({ name: 'Значение', deleted: true });
    expect(hydrator.hydrateMany).not.toHaveBeenCalled();
  });

  it('conditionName: вид папки, поле и прочее', async () => {
    const { service } = setup();
    await expect(
      service.conditionName(TX, [{ kind: 'folder', nodeKindId: 'kind-1' }], 0),
    ).resolves.toBe('Комплект');
    await expect(service.conditionName(TX, [{ kind: 'field', fieldNumber: 7 }], 0)).resolves.toBe(
      'Инв. №',
    );
    await expect(service.conditionName(TX, [{ kind: 'project' }], 0)).resolves.toBe('');
    await expect(service.conditionName(TX, [], 0)).resolves.toBe('');
    await expect(
      service.conditionName(TX, [{ kind: 'folder', nodeKindId: 'нет' }], 0),
    ).resolves.toBe('');
  });
});
