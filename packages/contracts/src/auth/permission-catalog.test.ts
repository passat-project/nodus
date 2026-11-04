import { updateRoleSchema } from '../directory/role.schemas.js';
import { describe, expect, it } from 'vitest';

import {
  PERMISSION_CATALOG,
  accessModuleSchema,
  permissionsOfModule,
} from './permission-catalog.js';
import { Permission } from './permission.js';

/**
 * Полнота каталога прав (#379, ADR-0034): новое право без записи в каталоге
 * или без названия/описания — баг модели, а не «забыли текст».
 */

describe('каталог прав (#379)', () => {
  it('каждое право каталога Permission встречается ровно один раз', () => {
    const listed = PERMISSION_CATALOG.map((entry) => entry.permission);
    expect(listed).toHaveLength(Object.values(Permission).length);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...Object.values(Permission)].sort());
  });

  it('названия и описания непустые и укладываются в лимиты строки таблицы', () => {
    for (const entry of PERMISSION_CATALOG) {
      expect(entry.label.trim(), entry.permission).not.toBe('');
      expect(entry.description.trim(), entry.permission).not.toBe('');
      expect(entry.label.length, `${entry.permission}: название длиннее 60`).toBeLessThanOrEqual(
        60,
      );
      expect(
        entry.description.length,
        `${entry.permission}: описание длиннее 120`,
      ).toBeLessThanOrEqual(120);
    }
  });

  it('у каждого раздела есть хотя бы одно право', () => {
    for (const module of accessModuleSchema.options) {
      expect(permissionsOfModule(module).length, module).toBeGreaterThan(0);
    }
  });

  it('«Автоматизация» — процессы, атрибуты, справочники, типы проектов', () => {
    expect(permissionsOfModule('automation').map((entry) => entry.permission)).toEqual([
      Permission.WORKFLOW_MANAGE,
      Permission.CUSTOM_FIELD_MANAGE,
      Permission.DICTIONARY_MANAGE,
      Permission.PROJECT_SETUP_MANAGE,
    ]);
  });

  it('«Проекты» — создание, управление, канал, системный надзор (#52)', () => {
    expect(permissionsOfModule('projects').map((entry) => entry.permission)).toEqual([
      Permission.PROJECT_CREATE,
      Permission.PROJECT_MANAGE,
      Permission.PROJECT_CHANNEL_POST,
      Permission.PROJECT_VIEW_SECRET,
    ]);
  });

  it('«Письма» — регистрация, решения и конфиденциальные; права v2 удалены (#55, #461)', () => {
    const letters = permissionsOfModule('correspondence');
    expect(letters.map((entry) => entry.permission)).toEqual([
      Permission.CORRESPONDENCE_REGISTER,
      Permission.CORRESPONDENCE_RESOLVE,
      Permission.CORRESPONDENCE_VIEW_CONFIDENTIAL,
    ]);
    expect(letters.map((entry) => entry.label)).toEqual([
      'Регистрировать письма',
      'Принимать решения по письмам',
      'Видеть конфиденциальные письма',
    ]);
    expect(letters[0]?.description).toContain('Вкладка «Новые»');
    expect(Object.values(Permission)).not.toContain('correspondence.create');
    expect(Object.values(Permission)).not.toContain('correspondence.archive');
  });

  it('срез раздела не теряет и не переставляет права', () => {
    const all = accessModuleSchema.options.flatMap((module) =>
      permissionsOfModule(module).map((entry) => entry.permission),
    );
    expect(all).toEqual(PERMISSION_CATALOG.map((entry) => entry.permission));
  });
});

describe('updateRoleSchema (#379)', () => {
  it('правка одного поля не подставляет права и описание по умолчанию', () => {
    expect(updateRoleSchema.parse({ name: 'Новое имя' })).toEqual({ name: 'Новое имя' });
    expect(updateRoleSchema.parse({})).toEqual({});
  });
});
