import { describe, expect, it } from 'vitest';

import {
  cardRefFromString,
  cardRefToString,
  isCardId,
  parseCardStack,
  sameCard,
  serializeCardStack,
} from './card-stack.js';

/** Реальные UUID: id карточки — строгий UUID (#908), литералы «t1» больше не
 *  проходят проверку deep-link. */
const TASK = '30000000-0000-4000-8000-000000000001';
const PROJECT = '30000000-0000-4000-8000-000000000002';
const LETTER = '30000000-0000-4000-8000-000000000003';
const CONVERSATION = '30000000-0000-4000-8000-000000000004';
const EMPLOYEE = '30000000-0000-4000-8000-000000000005';
const OTHER_TASK = '30000000-0000-4000-8000-000000000006';

describe('card-stack: (де)сериализация стека карточек в URL', () => {
  it('cardRefToString / cardRefFromString — обратимы', () => {
    const ref = { kind: 'task' as const, id: TASK };
    expect(cardRefFromString(cardRefToString(ref))).toEqual(ref);
  });

  it('cardRefFromString отбрасывает мусор', () => {
    expect(cardRefFromString('')).toBeNull();
    expect(cardRefFromString('nope')).toBeNull();
    expect(cardRefFromString(':task')).toBeNull();
    expect(cardRefFromString('wizard:123')).toBeNull();
    expect(cardRefFromString('task:')).toBeNull();
  });

  it('#908: id карточки — только UUID, путь в id не проходит', () => {
    expect(cardRefFromString('task:../directory/users')).toBeNull();
    expect(cardRefFromString('task:../../files/office-config')).toBeNull();
    expect(cardRefFromString(`task:${TASK}/../../directory/users`)).toBeNull();
    expect(cardRefFromString('task:t1')).toBeNull();
    expect(isCardId(TASK)).toBe(true);
    expect(isCardId('../directory/users')).toBe(false);
  });

  it('parseCardStack: строка search-параметра → стек, мусор пропускается', () => {
    expect(parseCardStack(`task:${TASK},project:${PROJECT}`)).toEqual([
      { kind: 'task', id: TASK },
      { kind: 'project', id: PROJECT },
    ]);
    expect(parseCardStack(`task:${TASK},junk,letter:${LETTER}`)).toEqual([
      { kind: 'task', id: TASK },
      { kind: 'letter', id: LETTER },
    ]);
    expect(parseCardStack(undefined)).toEqual([]);
    expect(parseCardStack('')).toEqual([]);
    expect(parseCardStack(42)).toEqual([]);
    expect(parseCardStack([`task:${TASK}`])).toEqual([]);
  });

  it('#908: deep-link с путём вместо id не открывает чужой маршрут', () => {
    expect(parseCardStack('task:../directory/users')).toEqual([]);
    expect(parseCardStack(`task:../directory/users,project:${PROJECT}`)).toEqual([
      { kind: 'project', id: PROJECT },
    ]);
    expect(parseCardStack('task:../../files/office-config')).toEqual([]);
  });

  it('мессенджер — сущность стека: messenger:<id> сериализуется и восстанавливается', () => {
    expect(parseCardStack(`task:${TASK},messenger:${CONVERSATION}`)).toEqual([
      { kind: 'task', id: TASK },
      { kind: 'messenger', id: CONVERSATION },
    ]);
    expect(
      serializeCardStack([
        { kind: 'task', id: TASK },
        { kind: 'messenger', id: CONVERSATION },
      ]),
    ).toBe(`task:${TASK},messenger:${CONVERSATION}`);
    expect(cardRefFromString('messenger:')).toBeNull();
    expect(cardRefFromString('chat:' + CONVERSATION)).toBeNull();
  });

  it('serializeCardStack: пустой стек → undefined (параметр уходит из URL)', () => {
    expect(serializeCardStack([])).toBeUndefined();
    expect(
      serializeCardStack([
        { kind: 'employee', id: EMPLOYEE },
        { kind: 'task', id: TASK },
      ]),
    ).toBe(`employee:${EMPLOYEE},task:${TASK}`);
  });

  it('#908: не-UUID id не попадает и в адрес (мост карточек — тот же вход)', () => {
    expect(serializeCardStack([{ kind: 'task', id: '../directory/users' }])).toBeUndefined();
    expect(
      serializeCardStack([
        { kind: 'task', id: '../directory/users' },
        { kind: 'task', id: TASK },
      ]),
    ).toBe(`task:${TASK}`);
  });

  it('sameCard сравнивает kind+id', () => {
    const a = { kind: 'task' as const, id: TASK };
    expect(sameCard(a, { kind: 'task', id: TASK })).toBe(true);
    expect(sameCard(a, { kind: 'task', id: OTHER_TASK })).toBe(false);
    expect(sameCard(a, { kind: 'letter', id: TASK })).toBe(false);
  });
});
