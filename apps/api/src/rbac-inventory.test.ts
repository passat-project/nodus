import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { beforeAll, describe, expect, it } from 'vitest';

import { IS_PUBLIC_KEY } from './core/decorators/public.decorator.js';
import { PERMISSIONS_KEY } from './core/decorators/require-permissions.decorator.js';

/**
 * Инвентаризация RBAC (I8, #320, #334): каждый маршрут API — мутирующий и
 * читающий — либо требует право (`@RequirePermissions`), либо публичный
 * (`@Public`), либо стоит в списке ниже с причиной — проверка доступа живёт
 * в сервисе (членство, владение, участие, фильтр видимости). Новый маршрут без решения валит тест: «забыл право»
 * больше не проходит гейты молча (класс находки аудита #317).
 */

import {
  INTENTIONALLY_PUBLIC,
  INTENTIONALLY_WITHOUT_PERMISSION,
} from './rbac-inventory.reasons.js';

interface RouteDecision {
  route: string;
  mutating: boolean;
  hasPermission: boolean;
  isPublic: boolean;
}

type Handler = (...args: unknown[]) => unknown;

const SRC = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Методы класса с унаследованными (Nest регистрирует маршруты базового класса). */
function methodNames(proto: object): string[] {
  const names = new Set<string>();
  for (let p: object | null = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const name of Object.getOwnPropertyNames(p)) names.add(name);
  }
  return [...names];
}

const joinPath = (...parts: string[]): string =>
  `/${parts.join('/')}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

/** Все маршруты всех контроллеров `src/**` (метаданные декораторов Nest). */
async function allRoutes(): Promise<RouteDecision[]> {
  const routes: RouteDecision[] = [];
  for (const file of sourceFiles(SRC).filter((f) => f.endsWith('.controller.ts'))) {
    const exported = (await import(file)) as Record<string, unknown>;
    for (const controller of Object.values(exported)) {
      if (typeof controller !== 'function') continue;
      const base: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      if (base === undefined) continue;
      // Путь-массив (`@Controller(['a','b'])`) молча выпал бы из инвентаризации.
      if (typeof base !== 'string') throw new Error(`${file}: путь контроллера не строка`);
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of methodNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (typeof method !== 'number') continue;
        const marker = (key: string): unknown =>
          Reflect.getMetadata(key, handler as Handler) ?? Reflect.getMetadata(key, controller);
        const permissions = marker(PERMISSIONS_KEY);
        const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        routes.push({
          route: `${RequestMethod[method]} ${joinPath(base, typeof path === 'string' ? path : '')}`,
          mutating: method !== RequestMethod.GET,
          hasPermission: Array.isArray(permissions) && permissions.length > 0,
          isPublic: marker(IS_PUBLIC_KEY) === true,
        });
      }
    }
  }
  return routes;
}

describe('RBAC-инвентаризация маршрутов (I8, #320, #334)', () => {
  let routes: RouteDecision[];

  // Импорт всех контроллеров (граф модулей api) — секунды под параллельной
  // нагрузкой turbo: один раз на файл и с запасом над дефолтными 5 с.
  beforeAll(async () => {
    routes = await allRoutes();
  }, 120_000);

  // Поиск по тексту `@Controller(`: алиас импорта или обёртка applyDecorators
  // его обойдут — контроллеры объявляются только напрямую (канон patterns.md).
  it('контроллер живёт только в *.controller.ts (иначе ускользнёт от инвентаризации)', () => {
    const misplaced = sourceFiles(SRC).filter(
      (f) => !f.endsWith('.controller.ts') && readFileSync(f, 'utf8').includes('@Controller('),
    );
    expect(misplaced).toEqual([]);
    expect(routes.filter((r) => r.mutating).length).toBeGreaterThan(50);
  });

  it('каждый маршрут — право, @Public или осознанное исключение с причиной', () => {
    const undecided = routes
      .filter((r) => !r.hasPermission && !r.isPublic)
      .filter((r) => !(r.route in INTENTIONALLY_WITHOUT_PERMISSION))
      .map((r) => r.route);
    expect(undecided, 'добавь @RequirePermissions или строку в список с причиной').toEqual([]);
  });

  it('@Public — только из списка с причиной и никогда вместе с правом (guard его не проверит)', () => {
    const publicRoutes = routes.filter((r) => r.isPublic);
    expect(
      publicRoutes.filter((r) => !(r.route in INTENTIONALLY_PUBLIC)).map((r) => r.route),
    ).toEqual([]);
    expect(publicRoutes.filter((r) => r.hasPermission).map((r) => r.route)).toEqual([]);
  });

  it('списки исключений не протухают', () => {
    const unguarded = new Set(
      routes.filter((r) => !r.hasPermission && !r.isPublic).map((r) => r.route),
    );
    const publicSet = new Set(routes.filter((r) => r.isPublic).map((r) => r.route));
    expect(
      Object.keys(INTENTIONALLY_WITHOUT_PERMISSION).filter((r) => !unguarded.has(r)),
      'маршрут удалён или получил право — убери строку',
    ).toEqual([]);
    expect(Object.keys(INTENTIONALLY_PUBLIC).filter((r) => !publicSet.has(r))).toEqual([]);
  });
});
