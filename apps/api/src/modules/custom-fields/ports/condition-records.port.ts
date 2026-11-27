import type { InjectionToken } from '@nestjs/common';
import type { ConditionSubject, CustomFieldValues, FormulaHostKind } from '@nodus/contracts';
import { CONDITION_LIMITS } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';

/**
 * Порт чтения множеств общей выборки #635 (unified-model §7 «Одна выборка
 * на всё»). Субъекты условия (подзадачи, связи, задачи папки/проекта, папки
 * проекта, сам проект, записи по ссылке) мапятся на множества записей
 * ЗДЕСЬ, в композиции портов владельцев (tasks/correspondence/projects) —
 * модуль workflows не читает чужие таблицы (I3), а custom-fields не знает
 * семантики условий (он только собирает записи).
 *
 * Три закона выборки (#635):
 * - квантор честный: полная выборка содержит ВСЕ живые записи, включая
 *   конфиденциальные и невидимые актору (иначе «все выполнены» врёт);
 *   мягко удалённые (deletedAt) исключаются всегда;
 * - видимость одна: в причину попадают только записи, видимые нажавшему
 *   (записи — той же функцией видимости, что у списков/карточек);
 * - потолок выборки: записей больше CONDITION_LIMITS.selection — выборка
 *   НЕ считается (fail-closed: условие ложно, проверка держит кнопку с
 *   причиной-переполнением); список множеств читается одним запросом с
 *   общим потолком, единичные записи потолком не ограничены.
 */
export const CONDITION_RECORDS_READER: InjectionToken = 'CONDITION_RECORDS_READER';

/** Результат чтения множества: записи + признак переполнения потолка. */
export interface ConditionSelection {
  records: ConditionRecordData[];
  /** Множество больше CONDITION_LIMITS.selection — квантор не считается. */
  overflowed: boolean;
}

/** Обрезка выборки по потолку (#635): take LIMIT+1 → records ≤ LIMIT. */
export function capSelection(rows: readonly ConditionRecordData[]): ConditionSelection {
  const overflowed = rows.length > CONDITION_LIMITS.selection;
  return {
    records: overflowed ? rows.slice(0, CONDITION_LIMITS.selection) : [...rows],
    overflowed,
  };
}

/** Единичная выборка (self/project/ref_field): потолка не превышает. */
export function singleSelection(records: ConditionRecordData[]): ConditionSelection {
  return { records, overflowed: false };
}

/** Запись общей выборки: что нужно предикатам (тип/поля/стадия) и причинам. */
export interface ConditionRecordData {
  kind: FormulaHostKind;
  id: string;
  /** Имя для причины («Задание → КЖ1.1»): название задачи/письма/проекта/папки. */
  name: string;
  /** Место записи: тип процесса (task/letter), тип проекта, вид папки. */
  typeId: string | null;
  /** Стадия маршрута записи (task/letter); у проекта/папки статусов нет (#856). */
  stageId: string | null;
  /** Значения атрибутов (JSONB как есть). */
  values: CustomFieldValues;
  projectId: string | null;
  parentId: string | null;
  nodeId: string | null;
}

/** Запись-хост выборки: категория сущности движка маршрутов. */
export interface ConditionHost {
  kind: 'task' | 'letter';
  id: string;
}

export interface ConditionRecordsReader {
  /** Полная выборка субъекта у записи-хоста (#635): все живые записи —
   *  включая невидимые актору (квантор честный); мягко удалённые исключены.
   *  Хост отсутствует/удалён — пустая выборка. Сверх потолка
   *  CONDITION_LIMITS.selection записи не возвращаются, `overflowed: true`:
   *  проверка по такой выборке не считается (fail-closed). */
  selection(
    host: ConditionHost,
    subject: ConditionSubject,
    tx?: TransactionClient,
  ): Promise<ConditionSelection>;

  /** Какие из записей видны актору — фильтр причин («видимость одна»):
   *  возвращает подмножество id. */
  visibleOf(
    records: readonly ConditionRecordData[],
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<ReadonlySet<string>>;
}
