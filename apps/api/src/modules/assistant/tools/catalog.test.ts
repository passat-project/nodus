import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { ALL_TOOLS, buildCatalog } from './catalog.js';

/**
 * Сверка каталога с маршрутами API (#892, ADR-0043 п. «риски»: дрейф API).
 *
 * Маршруты читаются из ТЕХ ЖЕ декораторов Nest, из которых генерируется
 * OpenAPI (`@Controller`+`@Get`, I2) — тот же механизм, что у
 * `rbac-inventory.test.ts`: исчезнувший или переименованный endpoint валит
 * тест до попадания в прод, без поднятия приложения и БД.
 */

const SRC = join(import.meta.dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

const joinPath = (...parts: string[]): string =>
  `/${parts.join('/')}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

/** GET-маршруты приложения в виде `/tasks/:id` (без глобального префикса). */
async function getRoutes(): Promise<Set<string>> {
  const routes = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const exported = (await import(file)) as Record<string, unknown>;
    for (const controller of Object.values(exported)) {
      if (typeof controller !== 'function') continue;
      const base: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      if (typeof base !== 'string') continue;
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method !== RequestMethod.GET) continue;
        const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        routes.add(joinPath(base, typeof path === 'string' ? path : ''));
      }
    }
  }
  return routes;
}

describe('каталог инструментов против маршрутов API (#892)', () => {
  it('каждый инструмент с API-операцией ссылается на существующий GET-маршрут', async () => {
    const routes = await getRoutes();
    expect(routes.size).toBeGreaterThan(50);
    const missing = ALL_TOOLS.filter((tool) => tool.api).filter(
      (tool) => !routes.has(tool.api!.path),
    );
    expect(
      missing.map((tool) => `${tool.id} → GET ${tool.api?.path}`),
      'маршрут удалён/переименован: обнови инструмент или убери его из каталога',
    ).toEqual([]);
  }, 60_000);

  it('только GET: инструмент чтения не описывает мутацию', () => {
    const notGet = ALL_TOOLS.filter((tool) => tool.api && tool.api.method !== 'GET');
    expect(notGet.map((tool) => tool.id)).toEqual([]);
  });

  it('у каждого инструмента есть операция API или собственный обработчик', () => {
    const broken = ALL_TOOLS.filter(
      (tool) => !tool.handler && !(tool.api && tool.build && tool.project),
    );
    expect(broken.map((tool) => tool.id)).toEqual([]);
  });
});

describe('состав каталога (#892)', () => {
  it('25 инструментов Ф1 и уникальные имена `module.action`', () => {
    expect(ALL_TOOLS).toHaveLength(25);
    expect(new Set(ALL_TOOLS.map((tool) => tool.id)).size).toBe(ALL_TOOLS.length);
    for (const tool of ALL_TOOLS) {
      expect(tool.id).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.keywords.length).toBeGreaterThan(0);
    }
  });

  it('горячая полка — 15–18 инструментов (ADR-0043 п. 4)', () => {
    const hot = ALL_TOOLS.filter((tool) => tool.hot);
    expect(hot.length).toBeGreaterThanOrEqual(15);
    expect(hot.length).toBeLessThanOrEqual(18);
  });

  it('read-only предохранитель: инструмент записи не регистрируется и не исполняется', () => {
    expect(ALL_TOOLS.every((tool) => tool.kind === 'read')).toBe(true);
    const catalog = buildCatalog({ permissions: [], features: [] });
    expect(catalog.every((tool) => tool.kind === 'read')).toBe(true);
  });
});

describe('фильтры каталога (#892)', () => {
  const allPermissions = [
    'assistant.use',
    'directory.read',
    'task.view_all',
    'project.view_secret',
  ];
  const allFeatures = ['tasks', 'projects', 'correspondence', 'chat'];

  it('без права directory.read справочник сотрудников недоступен', () => {
    const catalog = buildCatalog({ permissions: [], features: allFeatures });
    expect(catalog.some((tool) => tool.module === 'directory')).toBe(false);
    expect(catalog.length).toBe(ALL_TOOLS.length - 3);
  });

  it('без права права инструменты справочника появляются', () => {
    const catalog = buildCatalog({ permissions: allPermissions, features: allFeatures });
    expect(catalog.some((tool) => tool.id === 'directory.find_users')).toBe(true);
  });

  it('выключенный модуль не отдаёт свои инструменты (I10)', () => {
    const catalog = buildCatalog({ permissions: allPermissions, features: ['tasks'] });
    expect(catalog.some((tool) => tool.module === 'projects')).toBe(false);
    expect(catalog.some((tool) => tool.module === 'letters')).toBe(false);
    expect(catalog.some((tool) => tool.module === 'chat')).toBe(false);
    expect(catalog.some((tool) => tool.module === 'tasks')).toBe(true);
    // Ядро без флага (справочники, процессы, служебные) остаётся.
    expect(catalog.some((tool) => tool.module === 'dictionaries')).toBe(true);
    expect(catalog.some((tool) => tool.module === 'system')).toBe(true);
  });

  it('всё включено — полный каталог', () => {
    const catalog = buildCatalog({ permissions: allPermissions, features: allFeatures });
    expect(catalog).toHaveLength(ALL_TOOLS.length);
  });
});
