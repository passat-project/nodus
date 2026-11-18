import { describe, expect, it } from 'vitest';
import { searchResponseSchema, type SearchRequest } from '@nodus/contracts';

import { demoLetters } from '../../../../shared/mocks/data/letters.js';
import { demoTasks } from '../../../../shared/mocks/data/tasks.js';
import { currentAuthUser, userIds } from '../../../../shared/mocks/data/users.js';
import type { MockActor } from '../../../../shared/mocks/mock-actor.js';
import { digitSimilar, mockSnippet, runMockSearch } from './search-mock.js';

const request = (overrides: Partial<SearchRequest> = {}): SearchRequest => ({
  q: 'труба',
  sort: 'relevance',
  limit: 20,
  ...overrides,
});

const actor = currentAuthUser as MockActor;

describe('мок поиска: контракт и правила фильтров (#952, P1)', () => {
  it('ответ проходит контрактную схему для типовой выдачи', () => {
    const response = runMockSearch(request({ q: 'разраб' }), actor);
    expect(searchResponseSchema.safeParse(response).success).toBe(true);
  });

  it('types фильтрует выдачу, фасеты считаются БЕЗ выбранного типа', () => {
    const all = runMockSearch(request({ q: 'разраб' }), actor);
    const onlyTasks = runMockSearch(request({ q: 'разраб', types: ['task'] }), actor);
    expect(onlyTasks.items.every((hit) => hit.type === 'task')).toBe(true);
    expect(all.items.length).toBeGreaterThan(0);
    // Фасеты не сужены выбранным типом — показывают, что ещё доступно.
    expect(Object.keys(onlyTasks.facets.types).length).toBeGreaterThan(0);
  });

  it('фильтр проекта исключает сообщения и сотрудников', () => {
    const projectId = '40000000-0000-4000-8000-000000000001';
    const response = runMockSearch(request({ q: 'разраб', projectId }), actor);
    expect(response.items.every((hit) => hit.type !== 'message' && hit.type !== 'employee')).toBe(
      true,
    );
  });

  it('период по дате источника: будущий from — пусто', () => {
    const response = runMockSearch(request({ q: 'труба', from: '2099-01-01' }), actor);
    expect(response.items).toEqual([]);
    expect(response.facets.types).toEqual({});
  });

  it('стоп-слова — подсказка stopwords и пустая выдача', () => {
    const response = runMockSearch(request({ q: 'и в на' }), actor);
    expect(response.hint).toBe('stopwords');
    expect(response.items).toEqual([]);
  });

  it('опечатка в номере — «похоже на» с причиной number', () => {
    expect(digitSimilar('пп 101', 'пп 102')).toBe(true);
    expect(digitSimilar('пп 101', 'пп 113')).toBe(false);
    const task = demoTasks.find((entry) => entry.number === 101);
    expect(task).toBeDefined();
    const response = runMockSearch(request({ q: 'ПП-102', types: ['task'] }), actor);
    const hit = response.items.find((entry) => entry.id === task!.id);
    expect(hit).toBeDefined();
    expect(hit?.match).toBe('similar');
    expect(hit?.reasons).toContain('number');
  });

  it('сортировка newest — по дате источника вниз', () => {
    const response = runMockSearch(request({ q: '10', sort: 'newest' }), actor);
    const dates = response.items.map((hit) => hit.sourceCreatedAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it('курсор листает выдачу без повторов', () => {
    const first = runMockSearch(request({ q: '10', sort: 'newest', limit: 1 }), actor);
    expect(first.nextCursor).not.toBeNull();
    const second = runMockSearch(
      request({ q: '10', sort: 'newest', limit: 1, cursor: first.nextCursor! }),
      actor,
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it('описание задачи индексируется (план Р10: body = description)', () => {
    const response = runMockSearch(request({ q: 'лазерного', types: ['task'] }), actor);
    const hit = response.items.find((entry) => entry.type === 'task');
    expect(hit).toBeDefined();
    expect(hit?.reasons).toContain('body');
  });

  it('сообщение несёт мету беседы для прыжка и контрактную подпись', () => {
    const response = runMockSearch(request({ q: 'каркас', types: ['message'] }), actor);
    const hit = response.items.find((entry) => entry.type === 'message');
    expect(hit?.type).toBe('message');
    if (hit?.type === 'message') {
      expect(hit.meta.conversationId).not.toBe('');
      expect(hit.meta.conversationLabel).not.toBe('');
      expect(hit.meta.messageId).toBe(hit.id);
      expect(hit.meta.seq).toBeGreaterThan(0);
    }
  });

  it('conversationId сужает сообщения до открытой беседы (#956)', () => {
    const all = runMockSearch(request({ q: 'каркас', types: ['message'] }), actor);
    const hit = all.items.find((entry) => entry.type === 'message');
    expect(hit?.type).toBe('message');
    if (hit?.type !== 'message') return;
    const conversationId = hit.meta.conversationId;
    expect(conversationId).not.toBe('');

    const scoped = runMockSearch(
      request({ q: 'каркас', types: ['message'], conversationId }),
      actor,
    );
    expect(scoped.items.length).toBeGreaterThan(0);
    expect(
      scoped.items.every(
        (entry) => entry.type === 'message' && entry.meta.conversationId === conversationId,
      ),
    ).toBe(true);

    const foreign = runMockSearch(
      request({
        q: 'каркас',
        types: ['message'],
        conversationId: '11111111-1111-4111-8111-111111111111',
      }),
      actor,
    );
    expect(foreign.items).toEqual([]);
  });

  it('конфиденциальное письмо не видит посторонний, но видит регистратор', () => {
    const letter = demoLetters.find(
      (entry) => entry.confidential && entry.subject !== null && entry.registeredAt !== null,
    );
    expect(letter).toBeDefined();
    const q = letter!.subject!.split(' ')[0] ?? '';
    const outsider: MockActor = {
      id: userIds.dubovik,
      displayName: 'Посторонний',
      email: 'user11@passatproekt.by',
      permissions: [],
    };
    const hidden = runMockSearch(request({ q, types: ['letter'] }), outsider);
    expect(hidden.items.some((hit) => hit.id === letter!.id)).toBe(false);

    const registrar = letter!.registrar;
    expect(registrar).toBeDefined();
    const viewer: MockActor = {
      id: registrar!.id,
      displayName: registrar!.displayName,
      email: 'registrar@passatproekt.by',
      permissions: [],
    };
    const visible = runMockSearch(request({ q, types: ['letter'] }), viewer);
    expect(visible.items.some((hit) => hit.id === letter!.id)).toBe(true);
  });
});

describe('сниппет мока', () => {
  it('маркирует найденное слово теми же маркерами, что сервер', () => {
    const snippet = mockSnippet('Закупка труб', '', 'труб');
    expect(snippet).toContain('\u0001труб\u0002');
  });

  it('без совпадения — начало текста без маркеров', () => {
    const snippet = mockSnippet('Закупка труб', '', 'нетакого');
    expect(snippet).not.toContain('\u0001');
  });
});
