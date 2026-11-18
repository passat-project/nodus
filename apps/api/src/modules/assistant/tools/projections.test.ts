import { describe, expect, it } from 'vitest';

import {
  clip,
  date,
  dateTime,
  entityLink,
  finalize,
  isOverdue,
  itemsOf,
  listBlock,
  nameOf,
  nextCursor,
  num,
  pageItems,
  str,
} from './projections.js';

/**
 * Компактные проекции (#892): списки до 20 строк, обрезка с пометкой,
 * терпимость к отсутствующим полям. Ошибка проекции роняет прогон, поэтому
 * «мусор на входе» проверяется явно.
 */

describe('примитивы проекций', () => {
  it('str/num/nameOf не падают на мусоре', () => {
    expect(str('  ')).toBeNull();
    expect(str(42)).toBeNull();
    expect(num('42')).toBeNull();
    expect(nameOf(null)).toBeNull();
    expect(nameOf({ displayName: 'Иванов И.И.' })).toBe('Иванов И.И.');
    expect(nameOf({ name: 'Проект' })).toBe('Проект');
    expect(nameOf('Строка')).toBe('Строка');
  });

  it('itemsOf достаёт список из канона `{ items, nextCursor }`', () => {
    expect(itemsOf({ items: [1, 2], nextCursor: null })).toEqual([1, 2]);
    expect(itemsOf({ rows: [1] })).toEqual([]);
    expect(itemsOf(null)).toEqual([]);
  });

  it('pageItems: пустое тело 200 не роняет прогон, мусор отбрасывается', () => {
    // parseBody отдаёт null на пустое/не-JSON тело: проекция обязана вернуть [].
    expect(pageItems(null)).toEqual([]);
    expect(pageItems(undefined)).toEqual([]);
    expect(pageItems({ items: [{ id: 'a' }, null, 'x'], nextCursor: null })).toEqual([{ id: 'a' }]);
  });

  it('nextCursor отдаёт токен страницы и терпит мусор (#938)', () => {
    expect(nextCursor({ items: [], nextCursor: 'cursor-2' })).toBe('cursor-2');
    expect(nextCursor({ items: [] })).toBeNull();
    expect(nextCursor({ nextCursor: '' })).toBeNull();
    expect(nextCursor(null)).toBeNull();
  });

  it('даты: компактный вид без времени и с временем', () => {
    expect(date('2026-11-14T00:00:00.000Z')).toBe('14 ноя 2026');
    expect(dateTime('2026-11-14T15:30:00.000Z')).toBe('14 ноя 2026, 15:30');
    expect(date('не дата')).toBe('не дата');
    expect(date(null)).toBeNull();
    expect(isOverdue('2020-01-01T00:00:00.000Z')).toBe(true);
    expect(isOverdue('2999-01-01T00:00:00.000Z')).toBe(false);
    expect(isOverdue(null)).toBe(false);
  });
});

describe('listBlock', () => {
  it('нумерует строки и показывает остаток', () => {
    const rows = Array.from({ length: 25 }, (_, index) => `строка ${index + 1}`);
    const text = listBlock('Задачи', rows);
    expect(text.startsWith('Задачи: 25')).toBe(true);
    expect(text).toContain('1. строка 1');
    expect(text).toContain('20. строка 20');
    expect(text).toContain('… ещё 5');
    expect(text).not.toContain('строка 21');
  });

  it('помечает следующую страницу и пустой результат', () => {
    expect(listBlock('Письма', ['одно'], { more: true })).toContain('есть следующая страница');
    expect(listBlock('Письма', [])).toContain('(пусто)');
  });

  it('печатает cursor следующей страницы, если токен известен (#938)', () => {
    const text = listBlock('Задачи', ['одна'], { more: true, cursor: 'cursor-2' });
    expect(text).toContain('… есть следующая страница; cursor: cursor-2');
    // Без токена строка остаётся прежней — модель не получает пустой cursor.
    expect(listBlock('Задачи', ['одна'], { more: true, cursor: null })).toContain(
      'есть следующая страница (cursor)',
    );
  });

  it('clip и finalize обрезают с честной пометкой', () => {
    expect(clip('короткий текст', 100)).toBe('короткий текст');
    expect(clip('а'.repeat(50), 20)).toContain('[сокращено]');
    expect(finalize('б'.repeat(20_000)).length).toBeLessThanOrEqual(16_000);
    expect(finalize('ok')).toBe('ok');
  });

  it('ссылка «Открыть» — внутренняя форма карточки', () => {
    expect(entityLink('task', 'uuid-1', '№1 Задача')).toEqual({
      href: '?cards=task:uuid-1',
      label: '№1 Задача',
    });
  });
});
