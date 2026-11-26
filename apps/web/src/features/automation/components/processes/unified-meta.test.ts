import { describe, expect, it } from 'vitest';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

import {
  allowedProjectTypes,
  creationMeta,
  creationUsageText,
  kindUsageText,
  nodeKindMeta,
  projectTypeMeta,
} from './unified-meta.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const F1 = '44444444-4444-4444-8444-444444444444';

const PROJECT = (id: string, name: string, kindIds: string[] | null = null, archived = false) =>
  ({
    id,
    name,
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds,
    archivedAt: archived ? '2026-11-01T00:00:00.000Z' : null,
  }) as unknown as ProjectType;

const TYPE = (excluded: string[], config = true) =>
  ({
    id: 't1',
    category: 'task',
    archivedAt: null,
    ...(config
      ? {
          config: normalizeTypeConfig({
            creation: {
              excludedProjectTypeIds: excluded,
              folderKindId: null,
              withoutProject: true,
            },
          }),
        }
      : {}),
  }) as unknown as ProcessType;

const KIND = (form: unknown) =>
  ({
    id: 'k1',
    name: 'Комплект',
    icon: 'folder',
    color: 'blue',
    archivedAt: null,
    form,
    capabilities: [],
  }) as unknown as NodeKind;

describe('мета и подсказки единой колонки (#857)', () => {
  it('projectTypeMeta: живые + привязанные архивные типы, «7 типов»', () => {
    const kinds = [
      KIND(undefined),
      { ...KIND(undefined), id: 'k2', archivedAt: '2026-11-01T00:00:00.000Z' },
    ] as unknown as NodeKind[];
    // непривязанный архивный тип невидим — только живой
    expect(projectTypeMeta(PROJECT(P1, 'Договор', null), kinds)).toBe('1 тип');
    // архивный тип остаётся видимым, пока привязан
    expect(projectTypeMeta(PROJECT(P1, 'Договор', ['k1', 'k2']), kinds)).toBe('2 типа');
    expect(projectTypeMeta(PROJECT(P1, 'Договор', ['k1']), kinds)).toBe('1 тип');
  });

  it('allowedProjectTypes — модель исключений #665', () => {
    const projects = [PROJECT(P1, 'Договор'), PROJECT(P2, 'Тема')];
    const scope = normalizeTypeConfig({
      creation: { excludedProjectTypeIds: [P2], folderKindId: null, withoutProject: true },
    }).creation;
    expect(allowedProjectTypes(scope, projects).map((p) => p.id)).toEqual([P1]);
  });

  it('creationMeta: везде / без проекта / список с остатком / без конфигурации', () => {
    const projects = [PROJECT(P1, 'Договор'), PROJECT(P2, 'Тема'), PROJECT(P3, 'Тендер')];
    expect(creationMeta(TYPE([]), projects)).toBe(ui.automation.entry.metaAllowedEverywhere);
    expect(creationMeta(TYPE([P1, P2, P3]), projects)).toBe(ui.automation.entry.metaNoProjectOnly);
    expect(creationMeta(TYPE([P3]), projects)).toBe('Разрешён: Договор, Тема');
    expect(creationMeta(TYPE([P3], false), projects)).toBeNull();
    // живых типов проектов нет — только без проекта
    expect(creationMeta(TYPE([]), [])).toBe(ui.automation.entry.metaNoProjectOnly);
  });

  it('creationUsageText: подсказка шапки настроек типа', () => {
    const projects = [PROJECT(P1, 'Договор'), PROJECT(P2, 'Тема'), PROJECT(P3, 'Тендер')];
    expect(creationUsageText(TYPE([]), projects)).toBe(ui.automation.entry.usageEverywhere);
    expect(creationUsageText(TYPE([P1, P2, P3]), projects)).toBe(
      ui.automation.entry.metaNoProjectOnly,
    );
    expect(creationUsageText(TYPE([P3]), projects)).toBe(
      ui.automation.entry.usageIn.replace('{names}', 'Договор, Тема'),
    );
    expect(creationUsageText(TYPE([P1], false), projects)).toBeNull();
  });

  it('kindUsageText/nodeKindMeta: сколько живых типов проектов разрешают', () => {
    const projects = [
      PROJECT(P1, 'Договор', null),
      PROJECT(P2, 'Тема', ['99999999-9999-4999-8999-999999999999']),
    ];
    expect(kindUsageText(KIND(undefined), projects)).toBe('Используется: 1 тип проекта');
    // все разрешают (явные списки тоже) — «все типы проектов»
    expect(kindUsageText(KIND(undefined), [PROJECT(P1, 'Договор', null)])).toBe(
      ui.nodeKinds.screen.usageAllProjects,
    );
    // без живых типов проектов — меты использования нет, только атрибуты
    expect(nodeKindMeta(KIND(undefined), [])).toBe('0 атрибутов');
    // комбинированная мета: использование + атрибуты
    expect(nodeKindMeta(KIND({ fields: [{ fieldId: F1, state: 'required' }] }), projects)).toBe(
      'Используется: 1 тип проекта · 1 атрибут',
    );
  });
});
