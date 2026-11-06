import { describe, expect, it } from 'vitest';

import { resolveLinkTarget } from './link-target.js';

/** Классификация ссылок для перехватчика (#644): внутренние карточки — в
 *  приложение, внешние/системные — системными приложениями в десктопе. */

const BASE = 'https://nodus.by/chat/00000000-0000-4000-8000-000000000001';
const TASK = '11111111-1111-4111-8111-111111111111';
const LETTER = '22222222-2222-4222-8222-222222222222';

describe('resolveLinkTarget', () => {
  it('deep-link карточки задачи — внутренняя карточка', () => {
    expect(resolveLinkTarget(`https://nodus.by/tasks?cards=task:${TASK}`, BASE)).toEqual({
      kind: 'cards',
      cards: [{ kind: 'task', id: TASK }],
    });
  });

  it('стек из двух карточек — обе, в порядке URL', () => {
    expect(
      resolveLinkTarget(`https://nodus.by/?cards=letter:${LETTER},task:${TASK}`, BASE),
    ).toEqual({
      kind: 'cards',
      cards: [
        { kind: 'letter', id: LETTER },
        { kind: 'task', id: TASK },
      ],
    });
  });

  it('относительный ?cards= — тоже карточка', () => {
    expect(resolveLinkTarget(`?cards=task:${TASK}`, BASE)).toEqual({
      kind: 'cards',
      cards: [{ kind: 'task', id: TASK }],
    });
  });

  it('канонический portal://<вид>/<id> — карточка', () => {
    expect(resolveLinkTarget(`portal://task/${TASK}`, BASE)).toEqual({
      kind: 'cards',
      cards: [{ kind: 'task', id: TASK }],
    });
  });

  it('неизвестный вид в portal:// — штатное поведение', () => {
    expect(resolveLinkTarget(`portal://unknown/${TASK}`, BASE)).toEqual({ kind: 'default' });
  });

  it('не-UUID id карточки — не открываем (защита пути API)', () => {
    expect(resolveLinkTarget('portal://task/../../users', BASE)).toEqual({ kind: 'default' });
    expect(resolveLinkTarget('?cards=task:../../users', BASE)).toEqual({ kind: 'default' });
  });

  it('внешний http(s) — external', () => {
    expect(resolveLinkTarget('https://example.com/doc?x=1', BASE)).toEqual({
      kind: 'external',
      url: 'https://example.com/doc?x=1',
    });
  });

  it('свой origin без ?cards= — штатная навигация', () => {
    expect(resolveLinkTarget('https://nodus.by/tasks', BASE)).toEqual({ kind: 'default' });
    expect(resolveLinkTarget('/projects', BASE)).toEqual({ kind: 'default' });
  });

  it('mailto/tel — системные схемы', () => {
    expect(resolveLinkTarget('mailto:office@nodus.by', BASE)).toEqual({
      kind: 'system',
      url: 'mailto:office@nodus.by',
    });
    expect(resolveLinkTarget('tel:+375291234567', BASE)).toEqual({
      kind: 'system',
      url: 'tel:+375291234567',
    });
  });

  it('фрагмент, пустой href и неизвестная схема — штатное поведение', () => {
    expect(resolveLinkTarget('#content', BASE)).toEqual({ kind: 'default' });
    expect(resolveLinkTarget('javascript:alert(1)', BASE)).toEqual({ kind: 'default' });
    expect(resolveLinkTarget('nodus://chat/abc', BASE)).toEqual({ kind: 'default' });
  });
});
