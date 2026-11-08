import type { InjectionToken } from '@nestjs/common';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import type {
  NumberContainerMissingReason,
  NumberFieldSource,
  NumberHostAssignment,
  NumberHostKind,
  NumberIssueSource,
  NumberSeriesRule,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { NumberActor, NumberTarget } from './number-host.port.js';

/**
 * Движок выдачи номеров счётчиков (#630, модель v3) для модулей-владельцев
 * записей: план проверяет ВСЕ номера действия до выдачи (место счёта,
 * пустые вставки), выдача — в транзакции действия вызывающего. Отказ любого
 * номера откатывает действие целиком, счётчик не тратится. Эталон
 * поведения — мок-мир (`numbering-create.ts`), сервер повторяет его.
 */
export const NUMBER_ISSUE: InjectionToken = 'NUMBER_ISSUE';

export interface EmptySegmentInfo {
  fieldNumber: number;
  source: NumberFieldSource;
  name: string;
}

/** Почему номер не выдан: нет места (условия) или пустое поле-вставка без
 *  подтверждения человека. Ничего не потрачено. */
export type NumberingFailure =
  | {
      kind: 'missing';
      fieldId: string;
      fieldName: string;
      reason: NumberContainerMissingReason;
      index: number;
      /** Имя того, чего не нашлось: вид папки («Комплект») или поле. */
      name: string;
    }
  | {
      kind: 'empty';
      fieldId: string;
      fieldName: string;
      segments: EmptySegmentInfo[];
      example: string;
    };

export type NumberPlan =
  | {
      ok: true;
      /** Выдать номера записи в транзакции действия. */
      issue: (tx: TransactionClient, hostId: string) => Promise<Record<string, string>>;
    }
  | { ok: false; failure: NumberingFailure };

export interface NumberIssueOptions {
  hostKind: NumberHostKind;
  source: NumberIssueSource;
  /** Кто нажал — журнал выдачи (карточка «выдан кем»). */
  actorId?: string | null;
  /** Название кнопки на момент выдачи (у `transition`). */
  sourceLabel?: string | null;
  /** Человек подтвердил номер с пустой вставкой (после 409). */
  confirmEmpty?: boolean;
}

export interface NumberIssue {
  /**
   * План выдачи нескольких номеров одним действием: значения условий и
   * пустые вставки проверяются ДО любой выдачи; порядок — по id атрибута
   * (без встречных блокировок).
   */
  plan(
    tx: TransactionClient,
    fieldIds: readonly string[],
    target: NumberTarget,
    opts: NumberIssueOptions,
  ): Promise<NumberPlan>;

  /**
   * Все счётчики, у которых тип создаваемой/меняемой записи отмечен «при
   * создании». Поле, где номер уже есть, пропускается — кто первым
   * заполнил, тот выдал.
   */
  planOnCreate(
    tx: TransactionClient,
    target: NumberTarget,
    opts: {
      source: 'create' | 'type_change';
      /** Текущие значения записи (до создания — значения формы). */
      values: Readonly<Record<string, unknown>>;
      confirmEmpty?: boolean;
      actorId?: string | null;
    },
  ): Promise<NumberPlan>;

  /** Пример номера правила: первый номер нового счёта сейчас. */
  preview(rule: NumberSeriesRule): string;

  /** Номера одной записи (карточка, окно переноса). */
  hostAssignments(
    tx: TransactionClient,
    kind: NumberHostKind,
    id: string,
    actor: NumberActor,
  ): Promise<NumberHostAssignment[]>;
}

/** 409 выдачи номера: тот же формат `details`, что у мок-мира и API. */
export function numberingFailureException(failure: NumberingFailure): DomainException {
  if (failure.kind === 'empty') {
    return new DomainException(ErrorCode.NUMBER_SEGMENT_EMPTY, 'Number has an empty part', {
      fieldId: failure.fieldId,
      fieldName: failure.fieldName,
      segments: failure.segments,
      example: failure.example,
    });
  }
  return new DomainException(
    ErrorCode.NUMBER_CONTAINER_MISSING,
    `Number is not issued («${failure.fieldName}»)`,
    {
      fieldId: failure.fieldId,
      fieldName: failure.fieldName,
      reason: failure.reason,
      index: failure.index,
      name: failure.name,
    },
  );
}
