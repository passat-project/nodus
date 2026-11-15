import { useCallback, useMemo, useState } from 'react';

/** Состояние множественного выбора строк журнала (модель Битрикс24,
 *  вердикт владельца 15.09.2026): чекбокс строки + чекбокс «выбрать все»
 *  в хедере (indeterminate при частичном выборе). Выбор переживает фильтры
 *  и подгрузку страниц (ключи не сбрасываются) — групповые действия островка
 *  (#311) получают стабильный набор. Потребители: DataTable и TaskList (одинаковая
 *  механика во всех списках — принцип одного прохода). */
/** Состояние выбора строк журнала — контракт DataTable и островка действий. */
export interface RowSelection {
  selected: ReadonlySet<string>;
  toggle: (key: string) => void;
  /** Снять выбор с конкретной строки (удалённая запись не должна оставаться
   *  в счётчике островка — баг 25.10.2026: toggle на неудалённом ключе его
   *  ДОБАВЛЯЛ). */
  deselect: (key: string) => void;
  toggleAll: () => void;
  clear: () => void;
  headerChecked: boolean | 'indeterminate';
}

export function useRowSelection(rowKeys: readonly string[]): RowSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const deselect = useCallback((key: string) => {
    setSelected((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      // «Все видимые уже выбраны» считается по видимым ключам, а не по
      // размеру набора: выбор переживает фильтры/схлопывание веток, поэтому
      // prev.size может быть больше rowKeys.length — тогда первый клик
      // «выбрать все» обязан снять выбор, а не молча оставить его.
      const allVisible = rowKeys.length > 0 && rowKeys.every((key) => prev.has(key));
      const next = new Set(prev);
      if (allVisible) {
        for (const key of rowKeys) next.delete(key);
      } else {
        for (const key of rowKeys) next.add(key);
      }
      return next;
    });
  }, [rowKeys]);

  /** Состояние чекбокса хедера: все / часть / ничего. */
  const headerChecked: boolean | 'indeterminate' = useMemo(() => {
    if (rowKeys.length === 0 || selected.size === 0) return false;
    const visibleSelected = rowKeys.filter((k) => selected.has(k)).length;
    if (visibleSelected === 0) return false;
    return visibleSelected === rowKeys.length ? true : 'indeterminate';
  }, [rowKeys, selected]);

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, toggle, deselect, toggleAll, clear, headerChecked };
}
