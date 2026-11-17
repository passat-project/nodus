import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildManifest, renderStandardDoc } from './manifest.js';

/**
 * Документ стандарта и каталога (#926): генерируется из манифеста, поэтому
 * «добавил инструмент — забыл документацию» ловится CI, а не ревьюером.
 * Обновление — UPDATE_ASSISTANT_STANDARD=1 (команда в шапке файла).
 */

const DOC_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'docs',
  'architecture',
  'assistant-tool-standard.md',
);

describe('assistant-tool-standard.md: стандарт и каталог (#926)', () => {
  it('манифест содержит каждый инструмент ровно один раз', () => {
    const manifest = buildManifest();
    expect(new Set(manifest.map((tool) => tool.id)).size).toBe(manifest.length);
    expect(manifest.length).toBeGreaterThanOrEqual(41);
  });

  it('документ совпадает с генерацией (UPDATE_ASSISTANT_STANDARD=1)', () => {
    const generated = renderStandardDoc();
    if (process.env.UPDATE_ASSISTANT_STANDARD === '1') {
      writeFileSync(DOC_PATH, generated, 'utf8');
      return;
    }
    const current = readFileSync(DOC_PATH, 'utf8');
    expect(
      current,
      'стандарт устарел: запусти UPDATE_ASSISTANT_STANDARD=1 pnpm --filter @nodus/api exec vitest run src/modules/assistant/tools/manifest.test.ts',
    ).toBe(generated);
  });
});
