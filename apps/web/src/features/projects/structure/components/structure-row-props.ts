import type { CustomFieldRef, NodeKind } from '@nodus/contracts';

import type { RowMenuItem } from '../../../../shared/views/row-menu.js';
import type { StructureNodeRow, StructureTaskRow } from '../lib/structure-tree.js';
import type { DragPayload } from '../lib/use-structure-dnd.js';
import type { StructureAttributeDefs, StructureField } from './structure-cells.js';

/**
 * Пропсы и правила сравнения строк дерева структуры (A6-4, #632).
 * Наведение, смена зоны дропа и выбор строки перерисовывали ВСЁ дерево
 * (сотни папок и задач) — строки мемоизированы, а сравнение живёт здесь,
 * чтобы файл вида оставался про разметку (I5).
 *
 * Данные строки сравниваются по идентичности (`row`, `fields`, `attributes`,
 * `refs`, ширины grid), пункты меню — по подписи (новая ссылка массива на
 * каждый рендер родителя — не повод перерисовывать строку), payload переноса
 * — по содержимому выборки. Колбэки в сравнении НЕ участвуют: они замыкают
 * id этой же строки и вызываются только из события, поэтому «протухшая»
 * ссылка ведёт себя ровно так же, а новая идентичность на каждый рендер
 * родителя делала бы memo мёртвым.
 */

export interface StructureNodeRowProps {
  row: StructureNodeRow;
  kind: NodeKind | undefined;
  collapsed: boolean;
  onToggle: () => void;
  selected: boolean;
  onToggleSelected: () => void;
  /** Клик по строке — выбор папки для панели «Свойства» (#556). */
  onSelect: () => void;
  items: RowMenuItem[];
  /** Зона дропа над этой строкой (индикация). */
  zone: 'before' | 'into' | 'after' | null;
  invalid: boolean;
  isDragging: boolean;
  fields: readonly StructureField[];
  /** Определения атрибутных колонок по id поля (#632). */
  attributes: StructureAttributeDefs;
  /** Ссылки значений папок — карта по id (срез структуры проекта). */
  refs: ReadonlyMap<string, CustomFieldRef>;
  grid: { templateColumns: string };
  showSelection: boolean;
  readOnly: boolean;
}

export interface StructureTaskRowProps {
  row: StructureTaskRow;
  collapsed: boolean;
  onToggle: () => void;
  selected: boolean;
  onToggleSelected: () => void;
  items: RowMenuItem[];
  onOpen: (anchor: HTMLElement) => void;
  /** Мультиселект: за строкой тянется вся выборка. */
  dragData: DragPayload;
  isDragging: boolean;
  fields: readonly StructureField[];
  /** Определения атрибутных колонок по id поля (#632). */
  attributes: StructureAttributeDefs;
  grid: { templateColumns: string };
  showSelection: boolean;
  readOnly: boolean;
}

/** Подпись набора пунктов меню: id + текст (стрелки внутри не считаем). */
const menuSignature = (items: readonly RowMenuItem[]): string =>
  items.map((item) => `${item.id}\u0001${item.label}`).join('\u0002');

const sameGrid = (prev: { templateColumns: string }, next: { templateColumns: string }): boolean =>
  prev.templateColumns === next.templateColumns;

const sameDragData = (prev: DragPayload, next: DragPayload): boolean => {
  if (prev === next) return true;
  if (prev.kind === 'tasks' && next.kind === 'tasks') {
    return (
      prev.taskIds.length === next.taskIds.length &&
      prev.taskIds.every((id, index) => id === next.taskIds[index])
    );
  }
  return prev.kind === 'node' && next.kind === 'node' && prev.nodeId === next.nodeId;
};

/** Сравнение пропсов строки папки. */
export const sameNodeRowProps = (
  prev: StructureNodeRowProps,
  next: StructureNodeRowProps,
): boolean =>
  prev.row === next.row &&
  prev.kind === next.kind &&
  prev.collapsed === next.collapsed &&
  prev.selected === next.selected &&
  prev.zone === next.zone &&
  prev.invalid === next.invalid &&
  prev.isDragging === next.isDragging &&
  prev.fields === next.fields &&
  prev.attributes === next.attributes &&
  prev.refs === next.refs &&
  prev.showSelection === next.showSelection &&
  prev.readOnly === next.readOnly &&
  sameGrid(prev.grid, next.grid) &&
  menuSignature(prev.items) === menuSignature(next.items);

/** Сравнение пропсов строки задачи: то же плюс содержимое payload переноса. */
export const sameTaskRowProps = (
  prev: StructureTaskRowProps,
  next: StructureTaskRowProps,
): boolean =>
  prev.row === next.row &&
  prev.collapsed === next.collapsed &&
  prev.selected === next.selected &&
  prev.isDragging === next.isDragging &&
  prev.fields === next.fields &&
  prev.attributes === next.attributes &&
  prev.showSelection === next.showSelection &&
  prev.readOnly === next.readOnly &&
  sameGrid(prev.grid, next.grid) &&
  sameDragData(prev.dragData, next.dragData) &&
  menuSignature(prev.items) === menuSignature(next.items);
