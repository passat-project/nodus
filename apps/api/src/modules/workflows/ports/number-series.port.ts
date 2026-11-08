import type { InjectionToken } from '@nestjs/common';
import type {
  NumberContainer,
  NumberContainerHit,
  NumberHostKind,
  NumberIssueSource,
  NumberPeriod,
  NumberSeriesRule,
  NumberTemplateFieldReader,
  NumberTemplateSegment,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Хранилище серий и счетов номеров (#630, модель v3) для модуля атрибутов:
 * таблицы `number_series` / `number_counters` / `number_assignments`
 * принадлежат «Процессам» (I3), счётчик атрибута читает и пишет их только
 * через этот порт. Движок выдачи живёт в custom-fields (счётчик — тип
 * атрибута), серия письма — в `config.numbering` типа процесса.
 */
export const NUMBER_SERIES_STORE: InjectionToken = 'NUMBER_SERIES_STORE';

/** Серия в домене правила: JSONB-шаблон разобран, containers — условия. */
export interface NumberSeriesData {
  id: string;
  name: string;
  containers: NumberContainer[];
  period: NumberPeriod;
  template: NumberTemplateSegment[];
  startValue: number;
  step: number;
}

/** Счёт: значения условий × период. */
export interface NumberCounterRow {
  scopeKey: string;
  periodKey: string;
  hits: NumberContainerHit[];
  lastValue: number;
  year: number;
}

/** Строка журнала выдачи. */
export interface NumberAssignmentRow {
  seriesId: string;
  scopeKey: string;
  hits: NumberContainerHit[];
  periodKey: string;
  seq: number;
  display: string;
  hostKind: NumberHostKind;
  hostId: string;
  fieldId: string | null;
  actorId: string | null;
  source: NumberIssueSource;
  sourceLabel: string | null;
  assignedAt: Date;
}

/** Выданный номер: серия, счёт, порядковый номер и печатная строка. */
export interface AssignedNumber {
  seriesId: string;
  /** Ключ счёта (PK строки `number_counters`). */
  scopeKey: string;
  /** Значения условий счёта в порядке правила; [] — сквозная. */
  hits: NumberContainerHit[];
  periodKey: string;
  year: number;
  seq: number;
  /** «Вх-2026/118» — то, что видит человек и журнал перехода. */
  display: string;
  assignedAt: Date;
}

/** Кому и как выдан номер — строка журнала `number_assignments`. */
export interface NumberHost {
  kind: NumberHostKind;
  id: string;
  /** Атрибут-цель (null у письмо-серий). */
  fieldId: string | null;
  actorId: string | null;
  /** Способ выдачи: при создании, кнопкой, выдача существующим… */
  source: NumberIssueSource;
  /** Название кнопки на момент выдачи (у `transition`). */
  sourceLabel?: string | null;
}

export interface IssueNumberInput {
  /** Значения условий, найденные вызывающим (`resolveNumberContainers`); [] — сквозная. */
  hits: readonly NumberContainerHit[];
  at?: Date;
  /** Журнал выдачи: без host строка журнала не пишется. */
  host?: NumberHost;
  /** Поля-вставки номера: значения источников записи. */
  field?: NumberTemplateFieldReader;
}

export interface NumberSeriesStore {
  /** Серия с разобранным шаблоном; битый JSONB — null (номер не выдаётся). */
  byId(tx: TransactionClient, id: string): Promise<NumberSeriesData | null>;

  /** Пачка серий для гидрации DTO реестра атрибутов. */
  byIds(tx: TransactionClient, ids: readonly string[]): Promise<NumberSeriesData[]>;

  /** Новая серия счётчика: код уникален, имя — имя атрибута. */
  create(
    tx: TransactionClient,
    data: { code: string; name: string; rule: NumberSeriesRule },
  ): Promise<string>;

  /** Правка правила существующей серии (вид номера, старт, шаг, условия). */
  update(
    tx: TransactionClient,
    id: string,
    data: { name?: string; rule: NumberSeriesRule },
  ): Promise<void>;

  /** Следующий номер в счёте значений условий (в транзакции действия). */
  next(tx: TransactionClient, id: string, input: IssueNumberInput): Promise<AssignedNumber>;

  /** «Следующий номер» счёта — только вперёд. */
  setNext(
    tx: TransactionClient,
    id: string,
    input: { hits: readonly NumberContainerHit[]; nextValue: number; at?: Date },
  ): Promise<{ lastValue: number }>;

  /** Сколько номеров выдано каждой серии (журнал). */
  issuedCounts(tx: TransactionClient, ids: readonly string[]): Promise<Map<string, number>>;

  /** Все счета серии (окно «Текущие счета»). */
  counters(tx: TransactionClient, seriesId: string): Promise<NumberCounterRow[]>;

  /** Счёт значений условий и текущего периода; null — ещё не выдавали. */
  counter(
    tx: TransactionClient,
    seriesId: string,
    hits: readonly NumberContainerHit[],
    at?: Date,
  ): Promise<NumberCounterRow | null>;

  /** Журнал номеров одной записи (карточка, окно переноса). */
  assignments(
    tx: TransactionClient,
    hostKind: NumberHostKind,
    hostId: string,
  ): Promise<NumberAssignmentRow[]>;

  /** Есть ли у записи номер этой серии — «кто первым заполнил». */
  hasAssignment(
    tx: TransactionClient,
    seriesId: string,
    hostKind: NumberHostKind,
    hostId: string,
    fieldId: string | null,
  ): Promise<boolean>;
}
