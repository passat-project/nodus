import { describe, expect, it } from 'vitest';

import { DEPARTMENTS_TREE_PATH } from './departments-list.js';

/**
 * Страж контрактного пути дерева (#540): web, моки и пикеры обязаны ходить в
 * тот же маршрут, что API (`apps/api/src/modules/directory/departments.controller.ts`,
 * `@Get('tree')`; маршрут зафиксирован openapi-тестом API). Изменение пути —
 * только вместе с API и этим стражем.
 */
describe('DEPARTMENTS_TREE_PATH (#540)', () => {
  it('совпадает с маршрутом API GET /directory/departments/tree', () => {
    expect(DEPARTMENTS_TREE_PATH).toBe('/directory/departments/tree');
  });
});
