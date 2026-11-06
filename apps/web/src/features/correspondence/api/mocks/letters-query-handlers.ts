import type {
  DictionaryItem,
  LetterHistoryEntry,
  LetterListItem,
  Paginated,
  UserRef,
} from '@nodus/contracts';
import { Permission, SystemDictionary, listLettersQuerySchema } from '@nodus/contracts';
import { http, HttpResponse } from 'msw';

import { itemsOf } from '../../../../shared/mocks/data/dictionaries.js';
import {
  boxOf,
  canRegisterLetters,
  canSeeLetter,
  demoLetters,
  findLetter,
  letterDetailOf,
  letterHistory,
  letterListItemOf,
  letterTreeOf,
  viewedLetterIds,
  type DemoLetter,
} from '../../../../shared/mocks/data/letters.js';
import {
  mockEffectiveRoleIds,
  mockPermissionsOfRoleIds,
} from '../../../../shared/mocks/data/roles.js';
import { demoUserListItems } from '../../../../shared/mocks/data/users.js';
import { counterpartyMatcher } from '../../../../shared/mocks/live-counterparty.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { letterWithFormulas } from '../../../../shared/custom-fields/formula/formula-dto.js';
import { apiError, notFound } from './letters-mock-checks.js';

/** Чтение писем (#55, §6.2): списки вкладок курсором, держатели решений,
 *  способы поступления, карточка и журнал. Буквальные пути — раньше `:id`. */

/** Курсор мока — смещение строкой (сервер — keyset, контракт тот же). */
function page<T>(items: T[], cursor: string | null | undefined, limit: number): Paginated<T> {
  const start = cursor ? Number(cursor) || 0 : 0;
  const slice = items.slice(start, start + limit);
  const next = start + limit < items.length ? String(start + limit) : null;
  return { items: slice, nextCursor: next };
}

function matchesSearch(letter: DemoLetter, search: string | undefined): boolean {
  const q = search?.toLowerCase();
  if (!q) return true;
  return [
    letter.subject,
    letter.regNumber,
    letter.theirNumber,
    letter.counterparty?.name,
    // Поиск по номеру любого приложенного письма (#461, Р8): «456» находит
    // конверт, в котором лежит лист № 456.
    ...letter.attachedRefs.map((ref) => ref.number),
    ...letter.attachedRefs.map((ref) => ref.counterparty.name),
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(q));
}

const byDesc = (key: 'receivedAt' | 'registeredAt') => (a: DemoLetter, b: DemoLetter) =>
  (b[key] ?? '').localeCompare(a[key] ?? '') || b.id.localeCompare(a.id);

export const lettersQueryHandlers = [
  http.get('/api/v1/letters', async ({ request }) => {
    const raw = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = listLettersQuerySchema.safeParse(raw);
    if (!parsed.success) return apiError(400, 'VALIDATION_FAILED');
    const { box, counterpartyId, search, cursor, limit } = parsed.data;
    const actor = getMockActor();
    // «Новые» — только канцелярии (Р7): без права — 403, не пустой список.
    if (box === 'new' && !canRegisterLetters(actor)) return apiError(403, 'FORBIDDEN');
    let items = demoLetters
      .filter((letter) => canSeeLetter(letter, actor))
      .filter((letter) => (box ? boxOf(letter) === box : letter.registeredAt !== null));
    if (counterpartyId) {
      const matches = await counterpartyMatcher(counterpartyId, request);
      items = items.filter((letter) => matches(letter.counterparty));
    }
    items = items
      .filter((letter) => matchesSearch(letter, search))
      .sort(byDesc(box === 'new' ? 'receivedAt' : 'registeredAt'));
    return HttpResponse.json(
      page<LetterListItem>(
        // «Я открывал» — личный признак (редизайн #56): точка в «Новых».
        items.map((letter) =>
          letterListItemOf(letter, viewedLetterIds.has(letter.id) || letter.registeredAt !== null),
        ),
        cursor,
        limit ?? 50,
      ),
    );
  }),

  /** Держатели `correspondence.resolve` по алфавиту (Р13): группа
   *  «Принимают решения» в выборе адресата. */
  http.get('/api/v1/letters/resolvers', () => {
    const resolvers: UserRef[] = demoUserListItems
      .filter((user) => user.status === 'active')
      .filter((user) =>
        mockPermissionsOfRoleIds(mockEffectiveRoleIds(user.id)).includes(
          Permission.CORRESPONDENCE_RESOLVE,
        ),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'))
      .map((user) => ({ id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl }));
    return HttpResponse.json(resolvers);
  }),

  /** Справочник способов поступления (Р14) — в домене писем: регистрация на
   *  моках принимает только эти id (живой справочник + мок писем несовместимы). */
  http.get(`/api/v1/dictionaries/${SystemDictionary.RECEIPT_METHOD}/items`, () =>
    HttpResponse.json({
      items: itemsOf(SystemDictionary.RECEIPT_METHOD),
      nextCursor: null,
    } satisfies Paginated<DictionaryItem>),
  ),

  http.get('/api/v1/letters/:id', ({ params }) => {
    const letter = findLetter(String(params.id));
    const actor = getMockActor();
    if (!letter || !canSeeLetter(letter, actor)) return notFound();
    // Формулы типа письма (#632) — на чтении, поверх клонированного DTO.
    return HttpResponse.json(letterWithFormulas(letterDetailOf(letter, actor)));
  }),

  /** Дерево «ёлочки» (#461, Р2): корень — верх цепочки, текущее письмо
   *  подсвечивает клиент; невидимое письмо — 404 без оракула. */
  http.get('/api/v1/letters/:id/tree', ({ params }) => {
    const actor = getMockActor();
    const tree = letterTreeOf(String(params.id), actor);
    if (!tree) return notFound();
    return HttpResponse.json(tree);
  }),

  http.get('/api/v1/letters/:id/history', ({ params, request }) => {
    const letter = findLetter(String(params.id));
    if (!letter || !canSeeLetter(letter, getMockActor())) return notFound();
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit')) || 20;
    const entries = letterHistory.get(letter.id) ?? [];
    return HttpResponse.json(
      page<LetterHistoryEntry>(entries, url.searchParams.get('cursor'), limit),
    );
  }),
];
