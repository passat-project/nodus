import { useCallback, useMemo } from 'react';
import type { CustomFieldDefinition, ViewSort } from '@nodus/contracts';

import { useViewStore } from './view-store.js';
import { uiPx } from '../ui/ui-scale.js';

/** Группа поля в шестерёнке вида: системные поля модуля и атрибуты (#632). */
export type FieldGroup = 'system' | 'attributes';

/** Поле представления из реестра модуля: новое поле = +1 строка реестра. */
export interface FieldDef {
  id: string;
  /** Лейбл из contracts i18n (уже разрешённая строка). */
  label: string;
  defaultVisible: boolean;
  /** Ширина колонки таблицы по умолчанию, px. */
  defaultWidth?: number;
  /** Минимум при ресайзе — подбирается под осмысленный контент поля. */
  minWidth?: number;
  /** Максимум при ресайзе — защита от «растянуть за границу навсегда». */
  maxWidth?: number;
  /** Растягивается, заполняя свободное место (колонка названия). */
  flex?: boolean;
  /** Нельзя скрыть (название сущности). */
  locked?: boolean;
  /** Группа в шестерёнке вида: системные поля модуля или «Атрибуты» (#632).
   *  Не задана — системное поле (реестры без атрибутных колонок). */
  group?: FieldGroup;
  /** Определение атрибута, из которого построено поле (#632): по нему
   *  рендерится значение (грамматика типа) и подпись в шестерёнке. Есть
   *  только у полей группы «Атрибуты» — id таких полей `cf.<fieldId>`. */
  attribute?: CustomFieldDefinition;
}

export type ViewField<T extends FieldDef = FieldDef> = T & {
  visible: boolean;
  width?: number;
};

/**
 * Настройки вида: реестр модуля ⊕ сохранённое (неизвестные id отбрасываются,
 * новые поля модуля подхватываются дефолтами реестра — так система
 * масштабируется без миграций пресетов). ПОРЯДОК (концепт #4): поля с
 * сохранённым order — первыми по возрастанию order, поля без order (новые
 * в реестре или ни разу не упорядоченные) — следом в порядке реестра.
 * Дженерик сохраняет поля реестра (render и т.п.) в возвращаемом типе.
 */
export function useViewFields<T extends FieldDef>(viewKey: string, defs: T[]) {
  const stored = useViewStore((s) => s.views[viewKey]);
  const sort = useViewStore((s) => s.sorts[viewKey]);
  const setFieldVisible = useViewStore((s) => s.setFieldVisible);
  const setFieldWidth = useViewStore((s) => s.setFieldWidth);
  const applyOrder = useViewStore((s) => s.applyOrder);
  const setSort = useViewStore((s) => s.setSort);
  const resetView = useViewStore((s) => s.resetView);

  const fields = useMemo<ViewField<T>[]>(() => {
    const enriched = defs.map((d, registryIndex) => {
      const prefs = stored?.[d.id];
      return {
        field: {
          ...d,
          visible: prefs?.visible ?? d.defaultVisible,
          width: prefs?.width ?? (d.defaultWidth === undefined ? undefined : uiPx(d.defaultWidth)),
        } as ViewField<T>,
        orderKey: prefs?.order ?? 10_000 + registryIndex,
        registryIndex,
      };
    });
    enriched.sort((a, b) => a.orderKey - b.orderKey || a.registryIndex - b.registryIndex);
    return enriched.map((e) => e.field);
  }, [defs, stored]);

  /** Цикл сортировки по заголовку (двухстадийная ↑/↓, вердикт #4):
   *  чужое поле → asc; то же поле → смена направления. */
  const cycleSort = useCallback(
    (field: string) => {
      const next: ViewSort =
        sort?.field === field
          ? { field, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
          : { field, dir: 'asc' };
      setSort(viewKey, next);
    },
    [sort, setSort, viewKey],
  );

  /** Коммит порядка колонок на отпускании drag (одна механика DataTable и
   *  TaskList, аудит #45 — была дословной копией в обоих): видимые в новом
   *  порядке + скрытые следом (их место сохраняется), видимость передаётся
   *  ТЕКУЩАЯ — applyOrder её не насилует (урок воскресающих скрытых полей,
   *  view-store). */
  const commitOrder = useCallback(
    (ids: string[]) => {
      const byId = new Map(fields.map((f) => [f.id, f.visible] as const));
      applyOrder(
        viewKey,
        [...ids, ...fields.filter((f) => !f.visible).map((f) => f.id)].map((id) => ({
          id,
          visible: byId.get(id) ?? true,
        })),
      );
    },
    [applyOrder, viewKey, fields],
  );

  return {
    fields,
    visibleFields: useMemo(() => fields.filter((f) => f.visible), [fields]),
    sort,
    // Стабильная идентичность: предикат уходит в memo-компоненты карточек
    // (канбан на объёме), новая стрелка на каждый рендер ломала бы memo.
    isVisible: useCallback(
      (id: string) => fields.find((f) => f.id === id)?.visible ?? false,
      [fields],
    ),
    toggleField: (id: string, visible: boolean) => setFieldVisible(viewKey, id, visible),
    setWidth: (id: string, width: number) => setFieldWidth(viewKey, id, width),
    setOrder: (entries: { id: string; visible: boolean }[]) => applyOrder(viewKey, entries),
    commitOrder,
    cycleSort,
    reset: () => resetView(viewKey),
  };
}
