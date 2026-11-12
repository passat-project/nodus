import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BUTTON_STATES,
  BUTTON_STATE_CLASS,
  BUTTON_VARIANTS,
  RADII,
  TOKEN_GROUPS,
  TYPE_SCALE,
} from './dev-ui-tokens.js';

/**
 * Каталог галереи сверяется с ИСТОЧНИКОМ значений — `globals.css` (канон
 * темы). Без этой сверки переименованный токен оставлял бы страницу зелёной,
 * но врущей: свотч рисовал бы пустоту, а тест «форма имени» этого не видел.
 */
const GLOBALS_CSS = fileURLToPath(
  new URL('../../../../../packages/ui/src/styles/globals.css', import.meta.url),
);

/** Объявления кастомных свойств внутри блока, начинающегося с `marker`. */
function declarationsOf(css: string, marker: string): Set<string> {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`в globals.css нет блока «${marker}»`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  const body = css.slice(open + 1, close);
  return new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!));
}

const css = readFileSync(GLOBALS_CSS, 'utf8');
const lightTheme = declarationsOf(css, '\n:root {');
const darkTheme = declarationsOf(css, "[data-theme='dark'] {");
const themeScale = new Set([
  ...declarationsOf(css, '\n@theme {'),
  ...declarationsOf(css, '\n@theme inline {'),
]);

describe('dev-ui: каталог галереи', () => {
  it('каждая группа непустая, токены — только имена CSS-переменных', () => {
    for (const group of TOKEN_GROUPS) {
      expect(group.tokens.length, group.id).toBeGreaterThan(0);
      for (const token of group.tokens) {
        expect(token, group.id).toMatch(/^--[a-z0-9-]+$/);
      }
    }
  });

  it('токены не дублируются между группами', () => {
    const all = TOKEN_GROUPS.flatMap((group) => group.tokens);
    expect(new Set(all).size).toBe(all.length);
  });

  it('в галерее есть все семейства из Ф2', () => {
    const ids = TOKEN_GROUPS.map((group) => group.id);
    for (const id of ['surfaces', 'semantic', 'contour', 'bubbles', 'files', 'names', 'charts']) {
      expect(ids).toContain(id);
    }
  });

  it('каждый токен каталога объявлен в ОБЕИХ темах globals.css', () => {
    for (const group of TOKEN_GROUPS) {
      for (const token of group.tokens) {
        expect(lightTheme.has(token), `${token} в :root`).toBe(true);
        expect(darkTheme.has(token), `${token} в [data-theme='dark']`).toBe(true);
      }
    }
  });

  it('лестница кеглей объявлена в @theme', () => {
    for (const step of TYPE_SCALE) {
      expect(themeScale.has(`--${step.className}`), step.className).toBe(true);
    }
  });

  it('лестница радиусов объявлена в @theme + базовый --radius в :root', () => {
    for (const radius of RADII) {
      // rounded-md → --radius-md (утилита Tailwind ссылается на переменную радиуса).
      const variable = `--${radius.className.replace(/^rounded-/, 'radius-')}`;
      expect(themeScale.has(variable), `${radius.className} → ${variable}`).toBe(true);
    }
    expect(lightTheme.has('--radius')).toBe(true);
  });

  it('лестница кеглей: от label-xs до 2xl без повторов', () => {
    const classes = TYPE_SCALE.map((step) => step.className);
    expect(classes[0]).toBe('text-label-xs');
    expect(classes.at(-1)).toBe('text-2xl');
    expect(new Set(classes).size).toBe(classes.length);
  });

  it('матрица кнопок: у каждого варианта есть принудительные hover/active/focus', () => {
    for (const variant of BUTTON_VARIANTS) {
      for (const state of BUTTON_STATES) {
        if (state === 'default' || state === 'disabled') continue;
        expect(BUTTON_STATE_CLASS[variant][state], `${variant}/${state}`).toBeTruthy();
      }
    }
  });
});

describe('dev-ui: каталог читается из globals.css', () => {
  it('файл-источник действительно найден и разобран', () => {
    expect(lightTheme.size).toBeGreaterThan(50);
    expect(darkTheme.size).toBeGreaterThan(50);
    expect(lightTheme.has('--ui-scale')).toBe(true);
  });
});
