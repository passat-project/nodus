// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { insertNewlineAtCaret } from './composer-input-utils.js';

/** Перенос строки в каретку (#777): splice по выделению — хвост текста за
 *  выделением обязан выжить (нативное поведение textarea). */
describe('insertNewlineAtCaret (#777)', () => {
  it('без поля — перенос в конец текста', () => {
    expect(insertNewlineAtCaret(null, 'abc')).toEqual({ text: 'abc\n', caret: 4 });
  });

  it('каретка в середине — перенос в позицию каретки', () => {
    const el = document.createElement('textarea');
    el.value = 'abcdef';
    el.setSelectionRange(2, 2);
    expect(insertNewlineAtCaret(el, 'abcdef')).toEqual({ text: 'ab\ncdef', caret: 3 });
  });

  it('выделение заменяется переносом, хвост за выделением не теряется', () => {
    const el = document.createElement('textarea');
    el.value = 'abcdef';
    el.setSelectionRange(2, 5);
    expect(insertNewlineAtCaret(el, 'abcdef')).toEqual({ text: 'ab\nf', caret: 3 });
  });
});
