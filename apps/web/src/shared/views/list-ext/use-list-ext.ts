import { useCallback, useMemo, useState } from 'react';
import type { ListField, ListGroup, ListSort, ListTotal, SavedView } from '@nodus/contracts';

import type { ListExtParams } from './list-ext-query.js';

/**
 * Состояние расширения списка (#435): серверная сортировка, группировка,
 * итоги. Живёт в сессии списка (между сессиями — только в сохранённом виде:
 * «Сохранить как вид» уносит всё на сервер). Клик по заголовку колонки
 * идёт циклом asc → desc → сброс — грамматика concept #4.
 */

export interface ListExtState {
  sort: ListSort[];
  group?: ListGroup;
  totals: ListTotal[];
  /** Транспорт для query (стабильная ссылка на memo-потребителя). */
  params: ListExtParams;
  setSort: (sort: ListSort[]) => void;
  setGroup: (group: ListGroup | undefined) => void;
  setTotals: (totals: ListTotal[]) => void;
  reset: () => void;
  /** Текущее направление серверной сортировки колонки (стрелка хедера). */
  sortOfColumn: (field: string) => 'asc' | 'desc' | undefined;
  /** Клик по заголовку: asc → desc → нет (как cycleSort клиентской). */
  cycleColumnSort: (field: string, toField: (fieldId: string) => string | null) => void;
  /** Применить сохранённый вид: сортировка/группировка/итоги (фильтры и
   *  колонки применяет потребитель своими механиками). */
  applyViewExt: (view: Pick<SavedView, 'sort' | 'group' | 'totals'>) => void;
}

export function useListExt(): ListExtState {
  const [sort, setSort] = useState<ListSort[]>([]);
  const [group, setGroup] = useState<ListGroup | undefined>(undefined);
  const [totals, setTotals] = useState<ListTotal[]>([]);

  const params = useMemo<ListExtParams>(
    () => ({ filter: [], sort, group, totals }),
    [sort, group, totals],
  );

  const sortOfColumn = useCallback(
    (field: string) => sort.find((s) => s.field === field)?.dir,
    [sort],
  );

  const cycleColumnSort = useCallback(
    (fieldId: string, toField: (fieldId: string) => string | null) => {
      const field = toField(fieldId);
      if (!field) return;
      const listField = field as ListField;
      setSort((current) => {
        const active = current.find((s) => s.field === listField);
        if (!active) return [{ field: listField, dir: 'asc' as const }];
        if (active.dir === 'asc') return [{ field: listField, dir: 'desc' as const }];
        return current.filter((s) => s.field !== listField);
      });
    },
    [],
  );

  const applyViewExt = useCallback((view: Pick<SavedView, 'sort' | 'group' | 'totals'>) => {
    setSort(view.sort);
    setGroup(view.group);
    setTotals(view.totals);
  }, []);

  const reset = useCallback(() => {
    setSort([]);
    setGroup(undefined);
    setTotals([]);
  }, []);

  return useMemo(
    () => ({
      sort,
      group,
      totals,
      params,
      setSort,
      setGroup,
      setTotals,
      reset,
      sortOfColumn,
      cycleColumnSort,
      applyViewExt,
    }),
    [sort, group, totals, params, reset, sortOfColumn, cycleColumnSort, applyViewExt],
  );
}
