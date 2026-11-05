import { http, HttpResponse } from 'msw';
import type {
  CreateDictionaryBody,
  CreateDictionaryItemBody,
  Dictionary,
  DictionaryItem,
  Paginated,
  UpdateDictionaryItemBody,
} from '@nodus/contracts';
import {
  createDictionaryBodySchema,
  createDictionaryItemBodySchema,
  ErrorCode,
  PAGINATION_MAX_LIMIT,
  Permission,
  reorderDictionaryItemsBodySchema,
  updateDictionaryItemBodySchema,
} from '@nodus/contracts';

import { useAuthStore } from '../../auth-store.js';
import {
  demoDictionaries,
  demoDictionaryItems,
  dictionaryByCode,
  itemById,
  nextDictionaryCode,
} from '../../mocks/data/dictionaries.js';
import { demoSubtasks, demoTasks } from '../../mocks/data/tasks.js';

/** Запись справочников (#431, Р10): минимальный набор для вариантов
 *  атрибутов. Системный справочник защищён (409), имя варианта уникально
 *  среди активных, порядок — по sortOrder, вариант удаляется. */

function error(code: string, message: string, status: number) {
  return HttpResponse.json({ code, message }, { status });
}

/** Мок повторяет серверную проверку `dictionary.manage` (#491): без права
 *  создание справочника и правка вариантов — 403, а не тихий успех. */
function canManageDictionaries(): boolean {
  return (useAuthStore.getState().user?.permissions ?? []).includes(Permission.DICTIONARY_MANAGE);
}

function forbidden() {
  return error(ErrorCode.FORBIDDEN, 'Forbidden', 403);
}

function itemsOfDictionary(dictionaryId: string, includeArchived: boolean): DictionaryItem[] {
  return demoDictionaryItems
    .filter((item) => item.dictionaryId === dictionaryId)
    .filter((item) => includeArchived || item.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function nameTaken(dictionaryId: string, name: string, exceptId?: string): boolean {
  const key = name.trim().toLowerCase();
  return demoDictionaryItems.some(
    (item) =>
      item.dictionaryId === dictionaryId &&
      item.isActive &&
      item.id !== exceptId &&
      item.name.trim().toLowerCase() === key,
  );
}

export const dictionariesHandlers = [
  http.get('/api/v1/dictionaries', ({ request }) => {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), PAGINATION_MAX_LIMIT);
    const items = [...demoDictionaries]
      .sort((a, b) => a.code.localeCompare(b.code))
      .slice(0, limit);
    return HttpResponse.json({ items, nextCursor: null } satisfies Paginated<Dictionary>);
  }),

  http.post('/api/v1/dictionaries', async ({ request }) => {
    if (!canManageDictionaries()) return forbidden();
    const parsed = createDictionaryBodySchema.safeParse(await request.json());
    if (!parsed.success) return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 422);
    const body: CreateDictionaryBody = parsed.data;
    const dictionary: Dictionary = {
      id: crypto.randomUUID(),
      code: nextDictionaryCode(),
      name: body.name,
      hierarchical: false,
      isSystem: false,
    };
    demoDictionaries.push(dictionary);
    (body.items ?? []).forEach((name, index) => {
      demoDictionaryItems.push({
        id: crypto.randomUUID(),
        dictionaryId: dictionary.id,
        parentId: null,
        code: null,
        name,
        color: null,
        sortOrder: index,
        isActive: true,
      });
    });
    return HttpResponse.json(dictionary, { status: 201 });
  }),

  http.patch('/api/v1/dictionaries/:code', async ({ params, request }) => {
    if (!canManageDictionaries()) return forbidden();
    const dictionary = dictionaryByCode(String(params.code));
    if (!dictionary) return error(ErrorCode.NOT_FOUND, 'Dictionary not found', 404);
    if (dictionary.isSystem) {
      return error(ErrorCode.DICTIONARY_SYSTEM_LOCKED, 'System dictionary is locked', 409);
    }
    const body = (await request.json()) as { name?: string };
    if (body.name) dictionary.name = body.name.trim();
    return HttpResponse.json(dictionary);
  }),

  http.get('/api/v1/dictionaries/:code/items', ({ params, request }) => {
    const dictionary = dictionaryByCode(String(params.code));
    if (!dictionary) return error(ErrorCode.NOT_FOUND, 'Dictionary not found', 404);
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get('includeArchived') === 'true';
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), PAGINATION_MAX_LIMIT);
    const items = itemsOfDictionary(dictionary.id, includeArchived).slice(0, limit);
    return HttpResponse.json({ items, nextCursor: null } satisfies Paginated<DictionaryItem>);
  }),

  http.post('/api/v1/dictionaries/:code/items', async ({ params, request }) => {
    if (!canManageDictionaries()) return forbidden();
    const dictionary = dictionaryByCode(String(params.code));
    if (!dictionary) return error(ErrorCode.NOT_FOUND, 'Dictionary not found', 404);
    const parsed = createDictionaryItemBodySchema.safeParse(await request.json());
    if (!parsed.success) return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 422);
    const body: CreateDictionaryItemBody = parsed.data;
    if (nameTaken(dictionary.id, body.name)) {
      return error(ErrorCode.DICTIONARY_ITEM_NAME_TAKEN, 'Item name is taken', 409);
    }
    const maxOrder = Math.max(
      -1,
      ...demoDictionaryItems
        .filter((item) => item.dictionaryId === dictionary.id)
        .map((item) => item.sortOrder),
    );
    const item: DictionaryItem = {
      id: crypto.randomUUID(),
      dictionaryId: dictionary.id,
      parentId: null,
      code: body.code ?? null,
      name: body.name,
      color: null,
      sortOrder: maxOrder + 1,
      isActive: true,
    };
    demoDictionaryItems.push(item);
    return HttpResponse.json(item, { status: 201 });
  }),

  // Буквальный 'order' раньше ':id' (gotcha msw-query).
  http.put('/api/v1/dictionaries/:code/items/order', async ({ params, request }) => {
    if (!canManageDictionaries()) return forbidden();
    const dictionary = dictionaryByCode(String(params.code));
    if (!dictionary) return error(ErrorCode.NOT_FOUND, 'Dictionary not found', 404);
    const parsed = reorderDictionaryItemsBodySchema.safeParse(await request.json());
    if (!parsed.success) return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 422);
    const active = demoDictionaryItems.filter(
      (item) => item.dictionaryId === dictionary.id && item.isActive,
    );
    const ids = new Set(active.map((item) => item.id));
    if (parsed.data.ids.length !== ids.size || parsed.data.ids.some((id) => !ids.has(id))) {
      return error(ErrorCode.CONFLICT, 'Order is stale', 409);
    }
    parsed.data.ids.forEach((id, index) => {
      const item = itemById(id);
      if (item) item.sortOrder = index;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.patch('/api/v1/dictionaries/:code/items/:id', async ({ params, request }) => {
    if (!canManageDictionaries()) return forbidden();
    const item = itemById(String(params.id));
    if (!item) return error(ErrorCode.NOT_FOUND, 'Item not found', 404);
    const parsed = updateDictionaryItemBodySchema.safeParse(await request.json());
    if (!parsed.success) return error(ErrorCode.VALIDATION_FAILED, 'Invalid body', 422);
    const body: UpdateDictionaryItemBody = parsed.data;
    if (nameTaken(item.dictionaryId, body.name, item.id)) {
      return error(ErrorCode.DICTIONARY_ITEM_NAME_TAKEN, 'Item name is taken', 409);
    }
    item.name = body.name;
    if (body.color !== undefined) item.color = body.color;
    return HttpResponse.json(item);
  }),

  // Удаление варианта несистемного справочника (вердикт владельца
  // 25.10.2026: у вариантов атрибутов архива нет). Значения с ним читаются
  // пустыми — терпимое чтение; мок чистит ссылки у демо-задач, как сервер.
  http.delete('/api/v1/dictionaries/:code/items/:id', ({ params }) => {
    if (!canManageDictionaries()) return forbidden();
    const dictionary = dictionaryByCode(String(params.code));
    const item = itemById(String(params.id));
    if (!dictionary || !item || item.dictionaryId !== dictionary.id) {
      return error(ErrorCode.NOT_FOUND, 'Item not found', 404);
    }
    if (dictionary.isSystem) {
      return error(ErrorCode.DICTIONARY_SYSTEM_LOCKED, 'System dictionary is locked', 409);
    }
    demoDictionaryItems.splice(demoDictionaryItems.indexOf(item), 1);
    for (const task of [...demoTasks, ...Object.values(demoSubtasks).flat()]) {
      const values = task.customFields;
      if (!values) continue;
      for (const [fieldId, value] of Object.entries(values)) {
        if (value === item.id) delete values[fieldId];
        else if (Array.isArray(value) && value.some((entry) => entry === item.id)) {
          const rest = value.filter((entry) => entry !== item.id);
          if (rest.length > 0) values[fieldId] = rest as typeof value;
          else delete values[fieldId];
        }
      }
    }
    return new HttpResponse(null, { status: 204 });
  }),
];
