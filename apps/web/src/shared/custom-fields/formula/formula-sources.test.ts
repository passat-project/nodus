import type { CustomFieldDefinition, NodeKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { describe, expect, it } from 'vitest';

import { formulaSourceGroups } from './formula-sources.js';

/** Матрица источников палитры (#632, Р2/Р7): группы по виду носителя,
 *  тупики без родителя/проекта — пояснения, типовое умолчание без выборок. */

const STAMP = '2026-11-01T00:00:00.000Z';
const HOST_IDS = {
  task: '21000000-0000-4000-8000-0000000000t1',
  letter: '61000000-0000-4000-8000-0000000000l1',
  node: '44000000-0000-4000-8000-0000000000n1',
  project: '41000000-0000-4000-8000-0000000000p1',
} as const;

let seq = 0;
function def(
  id: string,
  name: string,
  extra: Partial<Pick<CustomFieldDefinition, 'type' | 'isCompany'>> & {
    processTypeIds?: string[];
    projectTypeIds?: string[];
    nodeKindIds?: string[];
  } = {},
): CustomFieldDefinition {
  seq += 1;
  return {
    id,
    number: seq,
    type: extra.type ?? 'number',
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: extra.isCompany ?? false,
    companyValue: null,
    bindings: {
      processTypeIds: extra.processTypeIds ?? [],
      projectTypeIds: extra.projectTypeIds ?? [],
      nodeKindIds: extra.nodeKindIds ?? [],
    },
    sortOrder: seq,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

const kind = (id: string, name: string): NodeKind => ({
  id,
  name,
  icon: 'layers',
  color: 'amber',
  archivedAt: null,
  form: { fields: [] },
  capabilities: [],
});

const KIND_BUILDING = '44000000-0000-4000-8000-0000000000b1';
const KIND_SECTION = '44000000-0000-4000-8000-0000000000b2';
const KINDS = [kind(KIND_BUILDING, 'Здание по генплану'), kind(KIND_SECTION, 'Раздел')];

/** Атрибуты реестра: свой, ссылка, проектный, папочный, компания, без мест. */
const SELF_A = def('a0000000-0000-4000-8000-000000000001', 'Номер комплекта');
const SELF_REF = def('a0000000-0000-4000-8000-000000000002', 'Задача-источник', { type: 'task' });
const PROJECT_FIELD = def('a0000000-0000-4000-8000-000000000003', 'Шифр', {
  projectTypeIds: ['41000000-0000-4000-8000-0000000000p2'],
});
const FOLDER_FIELD = def('a0000000-0000-4000-8000-000000000004', '№ по ГП', {
  nodeKindIds: [KIND_BUILDING],
});
const COMPANY_FIELD = def('a0000000-0000-4000-8000-000000000005', 'Срок мобилизации', {
  isCompany: true,
});
/** Без привязок к проекту — в группу «Проект» не попадает (матрица Р7). */
const LOOSE_FIELD = def('a0000000-0000-4000-8000-000000000006', 'Без привязок');

const ALL = [SELF_A, SELF_REF, PROJECT_FIELD, FOLDER_FIELD, COMPANY_FIELD, LOOSE_FIELD];

type Groups = ReturnType<typeof formulaSourceGroups>;
type GroupsArgs = Parameters<typeof formulaSourceGroups>[0];

/** Дефолтный вызов для задачи (родитель и проект есть) + переопределения. */
const taskGroups = (overrides: Partial<GroupsArgs> = {}): Groups =>
  formulaSourceGroups({
    host: { kind: 'task', id: HOST_IDS.task },
    ownDefinitions: [SELF_A],
    allDefinitions: ALL,
    kinds: KINDS,
    hasParent: true,
    hasProject: true,
    ...overrides,
  });

const group = (groups: Groups, key: string) => groups.find((entry) => entry.key === key);

const leafOf = (item: { leaf?: unknown }) =>
  item.leaf as {
    definition?: CustomFieldDefinition;
    source: { kind: string };
    system?: { entity: string; key: string };
  };

const leavesOf = (items: readonly { leaf?: unknown }[]) =>
  items.filter((item) => item.leaf).map(leafOf);

describe('formulaSourceGroups: матрица носителя task (#632, Р2/Р7)', () => {
  it('все группы на месте и по порядку: свои, родитель, папки, проект, компания, ссылки, связанные', () => {
    expect(taskGroups().map((entry) => entry.key)).toEqual([
      'self',
      'parent',
      'folders',
      'project',
      'company',
      'ref',
      'related',
    ]);
  });

  it('свои поля — источник self; системные поля носителя — туда же', () => {
    const leaves = leavesOf(group(taskGroups(), 'self')!.items);
    expect(leaves.find((leaf) => leaf.definition?.id === SELF_A.id)?.source).toEqual({
      kind: 'self',
    });
    expect(leaves.find((leaf) => leaf.system)?.system).toMatchObject({
      entity: 'task',
      key: 'title',
    });
  });

  it('без родителя и проекта — пункты-пояснения, не раскрывающиеся ветви', () => {
    const groups = taskGroups({ hasParent: false, hasProject: false });
    expect(group(groups, 'parent')!.items[0]).toMatchObject({
      key: 'parent:none',
      label: ui.formulas.sources.noParent,
      disabledHint: ui.formulas.sources.noParent,
    });
    expect(group(groups, 'project')!.items[0]).toMatchObject({
      key: 'project:none',
      disabledHint: ui.formulas.sources.noProject,
    });
  });

  it('родительская задача: обычные атрибуты и системные поля с источником parent_task', () => {
    const leaves = leavesOf(group(taskGroups(), 'parent')!.items);
    expect(leaves.find((leaf) => leaf.definition?.id === PROJECT_FIELD.id)?.source).toEqual({
      kind: 'parent_task',
    });
    expect(leaves.find((leaf) => leaf.definition?.id === COMPANY_FIELD.id)).toBeUndefined();
    expect(leaves.find((leaf) => leaf.system?.key === 'deadline')?.source).toEqual({
      kind: 'parent_task',
    });
  });

  it('папки: ветка вида — его атрибуты, системные поля папки и «цепочка папок»-агрегат', () => {
    const folders = group(taskGroups(), 'folders')!;
    expect(folders.items.map((item) => item.label)).toEqual(['Здание по генплану', 'Раздел']);
    const building = folders.items[0]!;
    const leaves = leavesOf(building.children!);
    // В вид попадают только привязанные к нему атрибуты — не все подряд.
    expect(leaves.find((leaf) => leaf.definition?.id === FOLDER_FIELD.id)?.source).toEqual({
      kind: 'folder_nearest',
      kindId: KIND_BUILDING,
    });
    expect(leaves.find((leaf) => leaf.definition?.id === SELF_A.id)).toBeUndefined();
    expect(leaves.find((leaf) => leaf.system?.entity === 'node')).toBeTruthy();
    expect(
      building.children!.find((child) => child.key === `folder-chain:${KIND_BUILDING}`)?.aggregate,
    ).toEqual({
      kind: 'aggregate',
      from: { kind: 'folder_chain', kindId: KIND_BUILDING },
      fn: 'count',
    });
  });

  it('проект: атрибуты с привязкой к типам проектов + системные поля проекта', () => {
    const leaves = leavesOf(group(taskGroups(), 'project')!.items);
    expect(leaves.find((leaf) => leaf.definition?.id === PROJECT_FIELD.id)?.source).toEqual({
      kind: 'project',
    });
    expect(leaves.find((leaf) => leaf.definition?.id === LOOSE_FIELD.id)).toBeUndefined();
    expect(leaves.find((leaf) => leaf.system?.entity === 'project')).toBeTruthy();
  });

  it('связанные записи задачи: подзадачи, задачи папки и связи — готовые агрегаты', () => {
    const related = group(taskGroups(), 'related')!;
    expect(related.items.map((item) => item.key)).toEqual([
      'related:subtasks',
      'related:node-tasks',
      'related:relations',
    ]);
    expect(related.items[0]!.aggregate).toEqual({
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'count',
    });
  });
});

describe('formulaSourceGroups: компания, ссылки и другие носители (#632, Р2/Р7)', () => {
  it('группа «Компания» — только глобальные переменные, источник company', () => {
    const leaves = leavesOf(group(taskGroups(), 'company')!.items);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.definition?.id).toBe(COMPANY_FIELD.id);
    expect(leaves[0]!.source).toEqual({ kind: 'company' });
  });

  it('ссылочный свой атрибут — ветка «По ссылке»: цель без самой ссылки', () => {
    const groups = taskGroups({ ownDefinitions: [SELF_A, SELF_REF] });
    const ref = group(groups, 'ref')!;
    expect(ref.items).toHaveLength(1);
    expect(ref.items[0]!.label).toBe('Задача-источник');
    const leaves = leavesOf(ref.items[0]!.children!);
    expect(leaves.find((leaf) => leaf.definition?.id === SELF_REF.id)).toBeUndefined();
    expect(leaves.find((leaf) => leaf.definition?.id === SELF_A.id)?.source).toEqual({
      kind: 'ref_field',
      field: SELF_REF.number,
    });
    // Ссылка на задачу раскрывает системные поля задачи.
    expect(leaves.find((leaf) => leaf.system?.entity === 'task')).toBeTruthy();
  });

  it('без ссылочных атрибутов — пояснение «нет атрибутов-ссылок»', () => {
    const groups = taskGroups({ allDefinitions: [SELF_A, PROJECT_FIELD] });
    expect(group(groups, 'ref')!.items[0]).toMatchObject({
      key: 'ref:none',
      label: ui.formulas.sources.noRefField,
    });
  });

  it('письмо: без родителя, папок, проекта и связанных; системные поля — письма', () => {
    const groups = formulaSourceGroups({
      host: { kind: 'letter', id: HOST_IDS.letter },
      ownDefinitions: [SELF_A],
      allDefinitions: ALL,
      kinds: KINDS,
      hasParent: false,
      hasProject: false,
    });
    expect(groups.map((entry) => entry.key)).toEqual(['self', 'company', 'ref']);
    expect(
      leavesOf(group(groups, 'self')!.items).find((leaf) => leaf.system?.key === 'subject'),
    ).toBeTruthy();
  });

  it('проект: без родителя и папок — свои поля, компания, ссылки', () => {
    const groups = formulaSourceGroups({
      host: { kind: 'project', id: HOST_IDS.project },
      ownDefinitions: [PROJECT_FIELD],
      allDefinitions: ALL,
      kinds: KINDS,
      hasParent: false,
      hasProject: false,
    });
    expect(groups.map((entry) => entry.key)).toEqual(['self', 'company', 'ref']);
  });

  it('папка: без родительской задачи, связанные — только задачи папки', () => {
    const groups = formulaSourceGroups({
      host: { kind: 'node', id: HOST_IDS.node },
      ownDefinitions: [FOLDER_FIELD],
      allDefinitions: ALL,
      kinds: KINDS,
      hasParent: false,
      hasProject: true,
    });
    expect(groups.map((entry) => entry.key)).toEqual([
      'self',
      'folders',
      'project',
      'company',
      'ref',
      'related',
    ]);
    expect(group(groups, 'related')!.items.map((item) => item.key)).toEqual(['related:node-tasks']);
  });

  it('виды папок не пришлюсь — группа «Папки» объясняет, что запись вне папок', () => {
    expect(group(taskGroups({ kinds: [] }), 'folders')!.items[0]).toMatchObject({
      key: 'folders:none',
      label: ui.formulas.sources.noFolder,
    });
  });
});

describe('formulaSourceGroups: типовое умолчание без выборок (#632, Р6)', () => {
  it('typeDefault: связанные записи исчезают, «цепочка папок» вырезается из видов', () => {
    const groups = taskGroups({ typeDefault: true });
    expect(group(groups, 'related')).toBeUndefined();
    const building = group(groups, 'folders')!.items[0]!;
    expect(building.children!.some((child) => child.key === `folder-chain:${KIND_BUILDING}`)).toBe(
      false,
    );
    expect(
      building.children!.some(
        (child) => child.leaf && leafOf(child).definition?.id === FOLDER_FIELD.id,
      ),
    ).toBe(true);
  });

  it('typeDefault: вид без своих атрибутов жив — системные поля папки остаются', () => {
    const groups = taskGroups({ kinds: [kind(KIND_SECTION, 'Раздел')], typeDefault: true });
    const section = group(groups, 'folders')!.items[0]!;
    expect(section.label).toBe('Раздел');
    expect(
      section.children!.some((child) => child.leaf && leafOf(child).system?.entity === 'node'),
    ).toBe(true);
  });
});
