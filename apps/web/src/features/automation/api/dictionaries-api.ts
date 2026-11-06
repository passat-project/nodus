import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDictionaryBody,
  CreateDictionaryItemBody,
  Dictionary,
  DictionaryItem,
  ReorderDictionaryItemsBody,
  UpdateDictionaryItemBody,
} from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { dictionariesKeys } from '../../../shared/dictionaries/keys.js';
import { DRAFT_PREFIX, type OptionDraft } from '../lib/field-draft.js';

/** Минимальная запись справочников (#431, Р10): варианты списков живут
 *  данными (I15), веб композирует API двух модулей, как «Автоматизация». */
export function invalidateDictionaries(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: dictionariesKeys.all });
}

/** Правка варианта (имя/цвет) — общий вызов для черновика и цвета. */
export function updateDictionaryItem(
  code: string,
  itemId: string,
  body: UpdateDictionaryItemBody,
): Promise<DictionaryItem> {
  return api<DictionaryItem>(`/dictionaries/${encodeURIComponent(code)}/items/${itemId}`, {
    method: 'PATCH',
    body,
  });
}

/** Новый справочник с вариантами — для атрибута-списка при создании. */
export function useCreateDictionary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDictionaryBody) =>
      api<Dictionary>('/dictionaries', { method: 'POST', body }),
    onSuccess: () => invalidateDictionaries(queryClient),
  });
}

/**
 * Применить черновик вариантов к справочнику: удалить → переименовать →
 * добавить → упорядочить. Последовательно (уникальность имени проверяет
 * сервер на каждом шаге: удалённое имя можно занять новым вариантом).
 * Возвращает отображение временных id в серверные — для умолчания.
 */
export async function commitOptionDrafts(
  code: string,
  original: readonly DictionaryItem[],
  drafts: readonly OptionDraft[],
): Promise<Map<string, string>> {
  const base = `/dictionaries/${encodeURIComponent(code)}/items`;
  const kept = new Set(drafts.map((draft) => draft.id));
  for (const item of original) {
    if (!kept.has(item.id)) await api<void>(`${base}/${item.id}`, { method: 'DELETE' });
  }
  const byId = new Map(original.map((item) => [item.id, item]));
  for (const draft of drafts) {
    const item = byId.get(draft.id);
    if (!item) continue;
    // Правка — только изменённые ключи: имя, цвет варианта (Р6 #631).
    const body: UpdateDictionaryItemBody = {};
    if (item.name !== draft.name) body.name = draft.name;
    if ((item.color ?? null) !== (draft.color ?? null)) body.color = draft.color ?? null;
    if (Object.keys(body).length > 0) {
      await updateDictionaryItem(code, item.id, body);
    }
  }
  const ids = new Map<string, string>();
  for (const draft of drafts) {
    if (!draft.id.startsWith(DRAFT_PREFIX)) continue;
    const created = await api<DictionaryItem>(base, {
      method: 'POST',
      body: { name: draft.name } satisfies CreateDictionaryItemBody,
    });
    // Цвет нового варианта: POST его не принимает (контракт #431), поэтому
    // досылаем PATCH сразу после создания (#646).
    if (draft.color) {
      await updateDictionaryItem(code, created.id, { color: draft.color });
    }
    ids.set(draft.id, created.id);
  }
  const order = drafts.map((draft) => ids.get(draft.id) ?? draft.id);
  const originalOrder = original.filter((item) => kept.has(item.id)).map((item) => item.id);
  if (order.length > 0 && order.join() !== originalOrder.join()) {
    await api<void>(`${base}/order`, {
      method: 'PUT',
      body: { ids: order } satisfies ReorderDictionaryItemsBody,
    });
  }
  return ids;
}
