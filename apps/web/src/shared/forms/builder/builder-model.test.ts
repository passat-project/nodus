import { describe, expect, it } from 'vitest';
import { FORM_DECOR_ID_PATTERN } from '@nodus/contracts';

import {
  itemId,
  lockOf,
  moveItem,
  newDecor,
  patchDecorText,
  patchField,
  removeItem,
  setLock,
  type BuilderItem,
} from './builder-model.js';

/** Модель редактора окна (#496): перестановка, правки, оформление, замки. */

const field = (key: string): BuilderItem<{ required: boolean }> => ({
  kind: 'field',
  key,
  label: null,
  hint: null,
  width: 'full',
  extra: { required: false },
});
const keys = (items: readonly BuilderItem<unknown>[]) => items.map(itemId);

describe('редактор окна: список элементов', () => {
  const items = [field('a'), field('b'), field('c')];

  it('перестановка «перед индексом» — вниз и вверх, на место — без изменений', () => {
    expect(keys(moveItem(items, 0, 2))).toEqual(['f:b', 'f:a', 'f:c']);
    expect(keys(moveItem(items, 0, 3))).toEqual(['f:b', 'f:c', 'f:a']);
    expect(keys(moveItem(items, 2, 0))).toEqual(['f:c', 'f:a', 'f:b']);
    expect(keys(moveItem(items, 1, 1))).toEqual(['f:a', 'f:b', 'f:c']);
    expect(keys(moveItem(items, 1, 2))).toEqual(['f:a', 'f:b', 'f:c']);
  });

  it('правка поля: пустые подпись и подсказка — стандартные; extra сливается', () => {
    const patched = patchField(items, 'b', {
      label: '  Кому выдаём ',
      hint: '   ',
      width: 'half',
      extra: { required: true },
    });
    expect(patched[1]).toMatchObject({
      label: 'Кому выдаём',
      hint: null,
      width: 'half',
      extra: { required: true },
    });
    expect(patchField(patched, 'b', { label: '' })[1]).toMatchObject({ label: null });
  });

  it('оформление: id по контракту, текст правится, отступ без текста, удаление по id', () => {
    const heading = newDecor('heading');
    expect(heading.id).toMatch(FORM_DECOR_ID_PATTERN);
    expect(newDecor('gap')).not.toHaveProperty('text');
    const withHeading: BuilderItem<unknown>[] = [heading, ...items];
    expect(patchDecorText(withHeading, heading.id, 'Кому и что')[0]).toMatchObject({
      text: 'Кому и что',
    });
    expect(keys(removeItem(withHeading, heading.id))).toEqual(['f:a', 'f:b', 'f:c']);
  });

  it('замки: поставить, сменить «кто правит», снять', () => {
    const locked = setLock([], 'deadline', 'owners');
    expect(lockOf(locked, 'deadline')).toBe('owners');
    const stricter = setLock(locked, 'deadline', 'none');
    expect(stricter).toEqual([{ key: 'deadline', editors: 'none' }]);
    expect(setLock(stricter, 'deadline', null)).toEqual([]);
    expect(lockOf([], 'deadline')).toBeNull();
  });
});
