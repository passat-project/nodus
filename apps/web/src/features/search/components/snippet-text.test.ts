import { describe, expect, it } from 'vitest';

import { splitSnippet } from './snippet-text.js';

describe('разбор сниппета по маркерам сервера (#952)', () => {
  it('выделяет отмеченные фрагменты текстовыми узлами', () => {
    expect(splitSnippet('трубы \u0001стальные\u0002 для котельной')).toEqual([
      { text: 'трубы ', marked: false },
      { text: 'стальные', marked: true },
      { text: ' для котельной', marked: false },
    ]);
  });

  it('несколько отметок подряд', () => {
    expect(splitSnippet('\u0001а\u0002 и \u0001б\u0002')).toEqual([
      { text: 'а', marked: true },
      { text: ' и ', marked: false },
      { text: 'б', marked: true },
    ]);
  });

  it('непарные маркеры не роняют разбор', () => {
    expect(splitSnippet('текст\u0001без конца')).toEqual([
      { text: 'текст', marked: false },
      { text: 'без конца', marked: true },
    ]);
  });

  it('пустая строка — пустой список', () => {
    expect(splitSnippet('')).toEqual([]);
  });
});
