import { describe, expect, it } from 'vitest';

import { replaceProcessesSurface } from './processes-surface-search.js';

/** Адрес, какой оставлял выбор типа папки ДО правила замены: все ключи поверхности сразу. */
const STALE = {
  tab: 'processes',
  type: 't1',
  ptype: 'p1',
  ftype: 'k1',
  noproject: '1',
  cards: 'task:x',
};

describe('адрес «Процессов»: выбор в колонке заменяет поверхность целиком', () => {
  it('любой патч поверхности снимает все четыре прежних ключа, прочие сохраняет', () => {
    expect(replaceProcessesSurface(STALE, { type: 't2' })).toEqual({
      tab: 'processes',
      cards: 'task:x',
      type: 't2',
    });
    expect(replaceProcessesSurface(STALE, { ftype: 'k2' })).toEqual({
      tab: 'processes',
      cards: 'task:x',
      ftype: 'k2',
    });
  });

  it('пустой патч — поверхность по умолчанию: ключей поверхности в адресе нет', () => {
    expect(replaceProcessesSurface(STALE, {})).toEqual({ tab: 'processes', cards: 'task:x' });
  });

  it('в адресе после выбора папки нет других ключей поверхности — она не может «заклинить» колонку', () => {
    const afterFolder = replaceProcessesSurface(STALE, { ftype: 'k1' });
    expect(afterFolder.ftype).toBe('k1');
    expect('type' in afterFolder).toBe(false);
    // Следующий выбор — снова замена: от папки не остаётся ничего.
    expect(replaceProcessesSurface(afterFolder, { ptype: 'p2' })).toEqual({
      tab: 'processes',
      cards: 'task:x',
      ptype: 'p2',
    });
  });

  it('прочие ключи адреса меняются патчем и не зависят от замены поверхности', () => {
    expect(
      replaceProcessesSurface(
        { ...STALE, tab: 'project-schemas' },
        { type: 't1', tab: 'processes' },
      ),
    ).toEqual({
      tab: 'processes',
      cards: 'task:x',
      type: 't1',
    });
  });
});
