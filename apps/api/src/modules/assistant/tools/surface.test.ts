import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { renderSurfaceMap } from './surface.js';

/**
 * Свежесть карты поверхностей ассистента (#918, ADR-0049): файл в docs/
 * обязан совпадать с генерацией из каталога. Расхождение = кто-то поменял
 * инструмент, но не обновил карту — CI красный до исправления.
 */

const MAP_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'docs',
  'architecture',
  'assistant-surface.md',
);

describe('assistant-surface.md: карта поверхностей (#918)', () => {
  it('совпадает с генерацией каталога (обновление — UPDATE_ASSISTANT_SURFACE=1)', () => {
    const generated = renderSurfaceMap();
    if (process.env.UPDATE_ASSISTANT_SURFACE === '1') {
      writeFileSync(MAP_PATH, generated, 'utf8');
      return;
    }
    const current = readFileSync(MAP_PATH, 'utf8');
    expect(
      current,
      'карта устарела: запусти UPDATE_ASSISTANT_SURFACE=1 pnpm --filter @nodus/api exec vitest run src/modules/assistant/tools/surface.test.ts',
    ).toBe(generated);
  });
});
