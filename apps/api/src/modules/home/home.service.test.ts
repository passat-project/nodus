import { describe, expect, it, vi } from 'vitest';

import { pickUpcomingBirthdays, type BirthdayUserRow } from './birthdays.js';
import type { HomeRepository } from './home.repository.js';
import { HomeService } from './home.service.js';

/** Чистая логика выбора дней рождения (#100): окно, «сегодня», сортировка,
 *  лимит, переход года и 29 февраля. */
const U = (id: string, iso: string, displayName = id): BirthdayUserRow => ({
  id,
  displayName,
  avatarUrl: null,
  birthDate: new Date(`${iso}T00:00:00.000Z`),
});

describe('pickUpcomingBirthdays', () => {
  const today = new Date('2026-10-01T00:00:00.000Z');

  it('берёт годовщины в окне, помечает «сегодня», сортирует по близости', () => {
    const got = pickUpcomingBirthdays(
      [
        U('a', '1990-10-10'), // через 9 дней
        U('b', '1985-10-01'), // сегодня
        U('c', '2000-10-03'), // через 2
        U('d', '1980-05-05'), // далеко в будущем окне прошлого года → следующий год, мимо
        U('e', '1995-10-16'), // за окном (15 дней) — мимо
      ],
      today,
    );
    expect(got.map((x) => x.user.id)).toEqual(['b', 'c', 'a']);
    expect(got[0]!.isToday).toBe(true);
    // Год рождения не отдаётся — только ближайшая годовщина (#342).
    expect(got[0]!.date).toBe('2026-10-01');
    expect(JSON.stringify(got)).not.toContain('1985');
    expect(got[1]!.isToday).toBe(false);
  });

  it('уже прошедшая в этом году годовщина берётся следующим годом', () => {
    const got = pickUpcomingBirthdays(
      [U('x', '1999-09-30')],
      new Date('2026-10-01T00:00:00.000Z'),
      370,
    );
    // 30.09.2026 прошло → 30.09.2027, за пределами окна 370? 364 дня — внутри.
    expect(got).toHaveLength(1);
    expect(got[0]!.isToday).toBe(false);
  });

  it('29 февраля в невисокосный год не теряет человека (1 марта)', () => {
    const got = pickUpcomingBirthdays(
      [U('leap', '2000-02-29')],
      new Date('2027-02-20T00:00:00.000Z'),
      14,
    );
    expect(got).toHaveLength(1);
  });

  it('лимит обрезает список, пустой вход — пустой выход', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      U(`u${i}`, `1990-10-${String(i + 1).padStart(2, '0')}`),
    );
    expect(pickUpcomingBirthdays(many, today)).toHaveLength(8);
    expect(pickUpcomingBirthdays([], today)).toEqual([]);
  });
});

describe('HomeService.getSummary', () => {
  it('собирает агрегат из репозитория: счёт активных + годовщины; заделы — честные нули', async () => {
    // Полдень UTC — та же календарная дата в любом поясе ±11 ч (детерминизм).
    vi.useFakeTimers({ now: new Date('2026-10-01T12:00:00.000Z') });
    // Произвольный счёт репозитория, не «красивый» штат (#723): тест проверяет
    // проброс значения, а конкретную величину считает репозиторий (status=active).
    const activeEmployees = 7;
    const repository = {
      countActiveEmployees: vi.fn(async () => activeEmployees),
      findActiveWithBirthDate: vi.fn(async () => [U('b', '1990-10-01'), U('far', '1990-05-05')]),
    };
    const service = new HomeService(repository as unknown as HomeRepository);

    const summary = await service.getSummary();
    vi.useRealTimers();

    expect(summary.stats).toEqual({
      employeeCount: activeEmployees,
      projectsDone: 0,
      dataNodes: 0,
    });
    expect(summary.birthdays.map((b) => b.user.id)).toEqual(['b']);
    expect(summary.labor).toEqual({ weeks: [], topOvertime: [] });
  });
});
