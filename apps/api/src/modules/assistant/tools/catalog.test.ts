import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { ALL_TOOLS, buildCatalog } from './catalog.js';

/**
 * Сверка каталога с маршрутами API (#892, Ф2 — #899, ADR-0043/0048: дрейф
 * API). Маршруты читаются из ТЕХ ЖЕ декораторов Nest, из которых генерируется
 * OpenAPI (`@Controller` + `@Get/@Post/...`, I2): исчезнувший или
 * переименованный endpoint валит тест до попадания в прод.
 *
 * Ф2 добавила запись: у каждого `kind: write` обязательна карточка
 * подтверждения — жёсткий предохранитель проверяется здесь.
 */

const SRC = join(import.meta.dirname, '..', '..', '..');

const METHODS: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

const joinPath = (...parts: string[]): string =>
  `/${parts.join('/')}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

/** Маршруты приложения в виде `GET /tasks/:id` (без глобального префикса). */
async function apiRoutes(): Promise<Set<string>> {
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
        const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        if (!method) continue;
        const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        routes.add(`${method} ${joinPath(base, typeof path === 'string' ? path : '')}`);
      }
    }
  }
  return routes;
}

describe('каталог инструментов против маршрутов API (#892)', () => {
  it('каждый инструмент с API-операцией ссылается на существующий маршрут', async () => {
    const routes = await apiRoutes();
    expect(routes.size).toBeGreaterThan(50);
    const missing = ALL_TOOLS.filter((tool) => tool.api).filter(
      (tool) => !routes.has(`${tool.api!.method} ${tool.api!.path}`),
    );
    expect(
      missing.map((tool) => `${tool.id} → ${tool.api?.method} ${tool.api?.path}`),
      'маршрут удалён/переименован: обнови инструмент или убери его из каталога',
    ).toEqual([]);
  }, 60_000);

  it('чтение — только GET, запись — только мутации', () => {
    const broken = ALL_TOOLS.filter(
      (tool) => tool.api && (tool.kind === 'read') !== (tool.api.method === 'GET'),
    );
    expect(broken.map((tool) => `${tool.id} (${tool.kind}, ${tool.api?.method})`)).toEqual([]);
  });

  it('у каждого инструмента есть операция API или собственный обработчик', () => {
    const broken = ALL_TOOLS.filter(
      (tool) => !tool.handler && !(tool.api && tool.build && tool.project),
    );
    expect(broken.map((tool) => tool.id)).toEqual([]);
  });
});

describe('состав каталога (#892, Ф2 #899)', () => {
  it('уникальные имена `module.action` и человеческие описания', () => {
    expect(ALL_TOOLS.length).toBeGreaterThanOrEqual(35);
    expect(new Set(ALL_TOOLS.map((tool) => tool.id)).size).toBe(ALL_TOOLS.length);
    for (const tool of ALL_TOOLS) {
      expect(tool.id).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.keywords.length).toBeGreaterThan(0);
    }
  });

  it('горячая полка — 18–26 инструментов (ADR-0043 п. 4, Ф2 добавила запись)', () => {
    const hot = ALL_TOOLS.filter((tool) => tool.hot);
    expect(hot.length).toBeGreaterThanOrEqual(18);
    expect(hot.length).toBeLessThanOrEqual(26);
  });

  it('действия Ф2 на месте: задачи, сообщение, резолюция, проекты, блокнот', () => {
    const writes = ALL_TOOLS.filter((tool) => tool.kind === 'write').map((tool) => tool.id);
    expect(writes).toEqual(
      expect.arrayContaining([
        'tasks.create',
        'tasks.update',
        'chat.send',
        'letters.transition',
        'projects.update',
        'projects.add_member',
        'projects.add_node',
      ]),
    );
    expect(ALL_TOOLS.some((tool) => tool.id === 'memory.save')).toBe(true);
  });

  it('жёсткий предохранитель: запись без карточки подтверждения не регистрируется', () => {
    for (const tool of ALL_TOOLS.filter((item) => item.kind === 'write')) {
      expect(tool.card, `${tool.id}: у записи обязательна карточка`).toBeTruthy();
      expect(tool.api?.method).not.toBe('GET');
    }
    // Каталог не отдаёт сотруднику write без карточки (фьюз каталога).
    const catalog = buildCatalog({ permissions: [], features: [] });
    expect(catalog.every((tool) => tool.kind === 'read' || tool.card)).toBe(true);
  });
});

describe('фильтры каталога (#892)', () => {
  const allPermissions = [
    'assistant.use',
    'directory.read',
    'task.view_all',
    'task.create',
    'project.view_secret',
  ];
  const allFeatures = ['tasks', 'projects', 'correspondence', 'chat'];

  it('без права directory.read справочник сотрудников недоступен', () => {
    const catalog = buildCatalog({ permissions: ['task.create'], features: allFeatures });
    expect(catalog.some((tool) => tool.module === 'directory')).toBe(false);
    expect(catalog.length).toBe(ALL_TOOLS.length - 3);
  });

  it('без права task.create действия по задачам недоступны', () => {
    const catalog = buildCatalog({ permissions: [], features: allFeatures });
    expect(catalog.some((tool) => tool.id === 'tasks.create')).toBe(false);
    // Чтение задач правом не ограничено (видимость фильтрует API).
    expect(catalog.some((tool) => tool.id === 'tasks.list')).toBe(true);
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
