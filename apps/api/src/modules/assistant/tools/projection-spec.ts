import {
  asArray,
  asRecord,
  date,
  dateTime,
  entityLink,
  finalize,
  hasMore,
  listBlock,
  nameOf,
  str,
} from './projections.js';
import type { ToolResult } from './tool-definition.js';

/**
 * Декларативная проекция ответа (#926, конвейер): «добавить инструмент =
 * данные». Для типовых чтений не нужна функция разбора — достаточно описать
 * поля и их формат; компилятор соберёт компактный текст для модели и ссылку
 * «Открыть». Сложные формы (иерархии, вычисления) остаются функциями
 * `project` — обратная совместимость.
 */

export type ProjectionFormat = 'text' | 'date' | 'dateTime' | 'name' | 'bool' | 'number';

export interface ProjectionField {
  /** Путь в ответе API: `title`, `stage.name`, `assignee.displayName`. */
  path: string;
  /** Человеческая подпись поля в строке. */
  label: string;
  format?: ProjectionFormat;
}

export interface ProjectionLink {
  /** Вид карточки для `?cards=<kind>:<id>`. */
  kind: string;
  /** Путь к id сущности в ответе. */
  idPath: string;
  /** Путь к человеческому названию; нет — первое поле. */
  labelPath?: string;
}

export interface ListProjectionSpec {
  kind: 'list';
  heading: string;
  /** Путь к массиву строк; по умолчанию `items`. */
  arrayPath?: string;
  fields: readonly ProjectionField[];
  link?: ProjectionLink;
  /** Показывать «есть следующая страница» по `nextCursor`. */
  more?: boolean;
}

export interface DetailProjectionSpec {
  kind: 'detail';
  heading: string;
  fields: readonly ProjectionField[];
  link?: ProjectionLink;
}

export type ProjectionSpec = ListProjectionSpec | DetailProjectionSpec;

function pick(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || value === undefined) return undefined;
    const record = value as Record<string, unknown>;
    return record[key];
  }, data);
}

function valueOf(raw: unknown, format: ProjectionFormat | undefined): string | null {
  switch (format) {
    case 'date':
      return date(raw);
    case 'dateTime':
      return dateTime(raw);
    case 'name':
      return nameOf(raw);
    case 'bool':
      return typeof raw === 'boolean' ? (raw ? 'да' : 'нет') : null;
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : null;
    default:
      return str(raw);
  }
}

function rowOf(item: unknown, fields: readonly ProjectionField[]): string | null {
  const parts = fields.flatMap((field) => {
    const value = valueOf(pick(item, field.path), field.format);
    return value ? [`${field.label}: ${value}`] : [];
  });
  return parts.length > 0 ? parts.join(' · ') : null;
}

function linkOf(data: unknown, link: ProjectionLink | undefined): ToolResult['entity'] | undefined {
  if (!link) return undefined;
  const id = str(pick(data, link.idPath));
  if (!id) return undefined;
  const label =
    str(pick(data, link.labelPath ?? '')) ??
    (typeof data === 'object' && data ? nameOf((data as Record<string, unknown>).title) : null) ??
    id;
  return entityLink(link.kind, id, label);
}

/** Компилятор декларативной проекции в функцию `project` инструмента. */
export function compileProjection(spec: ProjectionSpec): (data: unknown) => ToolResult {
  if (spec.kind === 'detail') {
    return (data) => {
      const record = asRecord(data);
      if (!record) return { text: `${spec.heading}: данные недоступны` };
      const lines = spec.fields.flatMap((field) => {
        const value = valueOf(pick(record, field.path), field.format);
        return value ? [`${field.label}: ${value}`] : [];
      });
      return {
        text: finalize([spec.heading, ...lines].join('\n')),
        entity: linkOf(record, spec.link),
      };
    };
  }
  return (data) => {
    const record = asRecord(data);
    // Справочники API отдают голый массив, списки — `{ items, nextCursor }`.
    const source = spec.arrayPath
      ? pick(record, spec.arrayPath)
      : Array.isArray(data)
        ? data
        : record?.items;
    const entries = asArray(source);
    const rows = entries
      .map((entry) => rowOf(entry, spec.fields))
      .filter((row): row is string => row !== null);
    return {
      text: finalize(
        listBlock(spec.heading, rows, { more: Boolean(spec.more) && hasMore(record) }),
      ),
    };
  };
}
