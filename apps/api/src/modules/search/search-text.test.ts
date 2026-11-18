import { describe, expect, it } from 'vitest';

import {
  clampSearchText,
  digitsOf,
  likePrefixPattern,
  sanitizeSearchText,
  snippetAround,
} from './search-text.js';

describe('текст поисковой проекции (#952)', () => {
  it('C0-символы вырезаются, перевод строки и табуляция остаются', () => {
    expect(sanitizeSearchText('a\u0001b\u0002c')).toBe('a b c');
    expect(sanitizeSearchText('a\nb\tc')).toBe('a\nb\tc');
    expect(sanitizeSearchText('a\u0000b')).toBe('a b');
  });

  it('длина ограничивается многоточием', () => {
    expect(clampSearchText('  abc  ', 10)).toBe('abc');
    expect(clampSearchText('abcdef', 4)).toBe('abc…');
  });

  it('префикс LIKE экранирует метасимволы', () => {
    expect(likePrefixPattern('50%')).toBe('50\\%%');
    expect(likePrefixPattern('a_b')).toBe('a\\_b%');
  });

  it('цифры номера задачи', () => {
    expect(digitsOf('ПП-123')).toBe('123');
    expect(digitsOf('пп 42')).toBe('42');
    expect(digitsOf('123')).toBe('123');
    expect(digitsOf('Вх-2026/431')).toBeNull();
    expect(digitsOf('труба')).toBeNull();
  });

  it('сниппет ставит маркеры вокруг слова запроса', () => {
    const text = 'Длинное описание про закупку труб для объекта на севере города';
    expect(snippetAround(text, 'труб')).toContain('\u0001труб\u0002');
  });

  it('опечатка — начало текста без маркеров', () => {
    const snippet = snippetAround('Поставка металлопроката на объект', 'миталлопрокат');
    expect(snippet).not.toContain('\u0001');
    expect(snippet.startsWith('Поставка')).toBe(true);
  });
});
