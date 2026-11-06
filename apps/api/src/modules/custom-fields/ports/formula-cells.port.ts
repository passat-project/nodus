import type { InjectionToken } from '@nestjs/common';
import type {
  CustomFieldFormulas,
  CustomFieldValue,
  FormulaCellError,
  FormulaHostKind,
  FormulaNode,
  FormulaResponse,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Порт формул ячеек атрибутов (#632, Р4/Р10/Р11). Мутации формулы живут у
 * ВЛАДЕЛЬЦА хоста (I3): эндпоинт модуля-владельца зовёт порт, порт проверяет
 * формулу, хранит её и зависимости, вычисляет результат — а значение
 * записывает и событие эмитит штатный writer владельца (Р4). Так
 * custom-fields не пишет чужие строки и не эмитит чужие события.
 *
 * Реализация — custom-fields (владелец таблиц formula_cells/formula_deps).
 */
export const FORMULA_CELLS: InjectionToken = 'FORMULA_CELLS';

/** Ссылка на ячейку-формулу (для пересчёта по зависимостям, Р4). */
export interface FormulaCellRef {
  cellId: string;
  hostKind: FormulaHostKind;
  hostId: string;
  fieldId: string;
}

/** Состояние формул ячеек хоста для DTO (Р9): origin + ошибка. */
export type FormulaStateMap = Map<string, CustomFieldFormulas>;

export interface FormulaSaveArgs {
  hostKind: FormulaHostKind;
  hostId: string;
  fieldId: string;
  ast: FormulaNode;
  /** Автор формулы — plain UUID (createdById). */
  actorId: string;
}

/** Итог сохранения/пересчёта: значение материализует владелец (writer). */
export interface FormulaComputation {
  value: CustomFieldValue | null;
  error: FormulaCellError | null;
}

/** Итог пересчёта ячейки: изменилось ли значение (шум-контроль каскада, Р4). */
export interface FormulaRecalcOutcome extends FormulaComputation {
  changed: boolean;
  /** true — событие не эмитится (живой цикл, Р8: волна останавливается). */
  silent: boolean;
}

export interface FormulaCells {
  /** Формульное состояние страницы хостов (деталь/списки, Р9): own-ячейки
   *  + формулы типа/вида (Р6). Хосты без формул в результат не попадают. */
  stateFor(
    hostKind: FormulaHostKind,
    hostIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<FormulaStateMap>;

  /** Эффективная формула ячейки для редактора (GET): своя, иначе формула
   *  типа/вида как основа правки; origin объясняет источник. */
  read(
    hostKind: FormulaHostKind,
    hostId: string,
    fieldId: string,
    tx?: TransactionClient,
  ): Promise<FormulaResponse>;

  /** Создать/заменить свою формулу ячейки: проверка AST → зависимости →
   *  запись ячейки → вычисление (источники читаются в tx). Блокирующая
   *  проблема — DomainException 422; ошибка вычисления сохранение не
   *  блокирует (Р13). */
  save(tx: TransactionClient, args: FormulaSaveArgs): Promise<FormulaComputation>;

  /** Снять формулу: последнее значение остаётся снимком (Р5). */
  remove(
    tx: TransactionClient,
    args: { hostKind: FormulaHostKind; hostId: string; fieldId: string },
  ): Promise<void>;

  /** Запись значения руками снимает формулу ячейки в той же tx (Р5).
   *  Зовётся точками записи значений владельцев. */
  release(
    tx: TransactionClient,
    hostKind: FormulaHostKind,
    hostId: string,
    fieldIds: readonly string[],
  ): Promise<void>;

  /** Ячейки, зависящие от значений конкретных атрибутов записи (Р4):
   *  dep_key `v:<kind>:<uuid>:<number>`. */
  dependentCellsByValues(
    hostKind: FormulaHostKind,
    hostId: string,
    numbers: readonly number[],
    tx?: TransactionClient,
  ): Promise<FormulaCellRef[]>;

  /** Ячейки, зависящие от атрибута с номером N в любом месте (Р13):
   *  удаление определения и смена значения компании. */
  dependentCellsByAttrNumber(number: number, tx?: TransactionClient): Promise<FormulaCellRef[]>;

  /** Все ячейки хоста (пересчёт после переноса/смены места, Р8). */
  cellsForHost(
    hostKind: FormulaHostKind,
    hostId: string,
    tx?: TransactionClient,
  ): Promise<FormulaCellRef[]>;

  /** Номер атрибута по id определения (событие definition_changed несёт id). */
  numberByDefinitionId(definitionId: string, tx?: TransactionClient): Promise<number | null>;

  /** Глубина последнего пересчёта ячейки (Р8): null — ячейки нет. Источник
   *  каскада задаёт глубину следующей волны (аккумулятор recalc_depth). */
  depthOf(
    hostKind: FormulaHostKind,
    hostId: string,
    fieldId: string,
    tx?: TransactionClient,
  ): Promise<number | null>;

  /** Пересчёт одной ячейки: re-check существования, re-extract зависимостей,
   *  вычисление, запись error/computed_at/recalc_depth. Значение пишет
   *  вызывающий writer (Р4). Глубина > лимита → ошибка cycle (Р8). */
  recalc(tx: TransactionClient, ref: FormulaCellRef, depth: number): Promise<FormulaRecalcOutcome>;

  /** Уборка ячеек удалённого/архивного хоста (Р4, «смерть связей»). */
  cleanupHost(tx: TransactionClient, hostKind: FormulaHostKind, hostId: string): Promise<void>;
}
