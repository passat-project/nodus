import { describe, expect, it } from 'vitest';

import { detectMentionQuery, mergeMentionCandidates } from './composer-mentions.js';

/** Логика @упоминаний композера (#176/#228): детектор запроса у каретки и
 *  слияние кандидатов; чипы/токены — composer-mention-registry (свои тесты). */

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('detectMentionQuery', () => {
  it('@ у каретки — панель с пустым запросом', () => {
    expect(detectMentionQuery('привет @', 8)).toEqual({ query: '', start: 7, end: 8 });
  });

  it('@ + буквы — запрос до каретки', () => {
    expect(detectMentionQuery('привет @арт', 11)).toEqual({ query: 'арт', start: 7, end: 11 });
  });

  it('каретка ушла дальше запроса (пробел) — закрыто', () => {
    expect(detectMentionQuery('привет @арт ', 12)).toBeNull();
  });

  it('email a@b — не запрос: @ в середине слова', () => {
    expect(detectMentionQuery('пиши на a@b', 12)).toBeNull();
  });

  it('@ в начале строки — валидно', () => {
    expect(detectMentionQuery('@анн', 4)).toEqual({ query: 'анн', start: 0, end: 4 });
  });

  it('запрос длиннее 32 символов — закрыто', () => {
    expect(detectMentionQuery('@' + 'а'.repeat(33), 34)).toBeNull();
  });
});

describe('mergeMentionCandidates', () => {
  const members = [{ id: UUID_A, displayName: 'Анна Первая', avatarUrl: null }];
  const directory = [
    {
      id: UUID_A,
      displayName: 'Анна Первая',
      status: 'active' as const,
      avatarUrl: null,
      positionName: 'ГИП',
      departmentName: 'Изыскания',
      email: 'anna@nodus.local',
      managerId: null,
      departmentId: null,
      legalDepartmentId: null,
      positionId: null,
      legalPositionId: null,
    },
    {
      id: UUID_B,
      displayName: 'Борис Второй',
      status: 'active' as const,
      avatarUrl: null,
      positionName: 'ГИП',
      departmentName: 'Изыскания',
      email: 'boris@nodus.local',
      managerId: null,
      departmentId: null,
      legalDepartmentId: null,
      positionId: null,
      legalPositionId: null,
    },
  ];

  it('«Все» первой строкой, затем участники и справочник; себя нет (#224)', () => {
    const list = mergeMentionCandidates(members, directory, '', undefined);
    expect(list[0]).toMatchObject({ id: 'all', isAll: true, inConversation: true });
    expect(list[1]).toMatchObject({
      id: UUID_A,
      inConversation: true,
      positionName: 'ГИП',
    });
    expect(list[2]).toMatchObject({ id: UUID_B, inConversation: false });
    // Себя не предлагаем (сервер пингует только ≠ автора): я = Анна.
    const asAnna = mergeMentionCandidates(members, directory, '', UUID_A);
    expect(asAnna.map((c) => c.id)).toEqual(['all', UUID_B]);
  });

  it('«Все» показывается по вводе «все», скрывается чужим запросом (#224)', () => {
    expect(mergeMentionCandidates([], [], 'вс', undefined)[0]?.id).toBe('all');
    expect(mergeMentionCandidates([], [], 'все', undefined)[0]?.id).toBe('all');
    expect(mergeMentionCandidates(members, [], 'б', undefined).some((c) => c.isAll)).toBe(false);
  });

  it('фильтр участников по подстроке без регистра', () => {
    const list = mergeMentionCandidates(members, [], 'АНН', undefined);
    expect(list.map((c) => c.id)).toEqual([UUID_A]);
  });

  it('поиск справочника по ФИО находит не-участника', () => {
    const list = mergeMentionCandidates([], directory, 'втор', undefined);
    expect(list.map((c) => c.id)).toEqual([UUID_B]);
    expect(list[0]?.inConversation).toBe(false);
  });
});
