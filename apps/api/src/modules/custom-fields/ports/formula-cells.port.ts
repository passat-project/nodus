import type { InjectionToken } from '@nestjs/common';
import type {
  CustomFieldFormulas,
  CustomFieldType,
  CustomFieldValue,
  CustomFieldValues,
  FormulaCellError,
  FormulaHostKind,
  FormulaNode,
  FormulaResponse,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';

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

/** Состояние ячеек хоста для DTO (Р9/Р6): значения (формулы типа посчитаны
 *  на чтении и в БД не лежат) + origin/ошибка каждой формульной ячейки. */
export interface FormulaHostState {
  values: CustomFieldValues;
  formulas: CustomFieldFormulas;
}

/** Состояние хостов страницы: hostId → значения и формулы. */
export type FormulaStateMap = Map<string, FormulaHostState>;

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
  /** Сменилось ли НАЛИЧИЕ ошибки (O4): только тогда эмитится адресное
   *  `custom_field.formula_changed`; успешный пересчёт значения — молча. */
  errorChanged: boolean;
  /** true — событие не эмитится (живой цикл, Р8: волна останавливается). */
  silent: boolean;
}

/** Подмена места для dry-run переноса (Р10 move-preview): дерево в БД ещё
 *  старое, а формулы должны посчитаться как после переноса. */
export interface FormulaPreviewOverride {
  /** Новый родитель папок: `nodeId → parentId | null` (null — корень). */
  nodeParent?: Readonly<Record<string, string | null>>;
  /** Новый узел задач: `taskId → nodeId | null`. */
  taskNode?: Readonly<Record<string, string | null>>;
}

/** Строка диффа move-preview: что станет с формульным значением записи. */
export interface FormulaPreviewEntry {
  hostKind: FormulaHostKind;
  hostId: string;
  fieldId: string;
  /** Подпись записи (номер/название) — диалог подтверждения. */
  hostLabel: string;
  fieldName: string;
  from: CustomFieldValue | null;
  to: CustomFieldValue | null;
}

export interface FormulaCells {
  /** Формульное состояние страницы хостов (деталь/списки, Р9): own-ячейки
   *  + формулы типа/вида (Р6). Хосты без формул в результат не попадают.
   *  `places` (hostId → typeId/kindId) — подсказка из строк листинга: хосты
   *  без формул своего места не читаются вовсе (иначе список платит N+1). */
  stateFor(
    hostKind: FormulaHostKind,
    hostIds: readonly string[],
    tx?: TransactionClient,
    places?: ReadonlyMap<string, string | null>,
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

  /** Снять формулу (значение ячейки очищает вызывающий: своя формула —
   *  способ заполнения, без неё ячейка пуста или под формулой типа, #660). */
  remove(
    tx: TransactionClient,
    args: { hostKind: FormulaHostKind; hostId: string; fieldId: string },
  ): Promise<void>;

  /** Формульно-заблокированные ключи среди fieldIds (#632, #660): у атрибута
   *  есть своя формула или формула привязки места — значение пишет только
   *  формула, ручная запись запрещена (422 FORMULA_CELL_LOCKED). Зовётся
   *  точками записи значений владельцев. */
  lockedFieldIds(
    tx: TransactionClient,
    hostKind: FormulaHostKind,
    hostId: string,
    fieldIds: readonly string[],
  ): Promise<Set<string>>;

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

  /** Ячейки по точному ключу зависимости (`tree:project:<id>`,
   *  `nodetasks:node:<id>`, `rel:task:<id>`, `parent:task:<id>`): событие
   *  структуры/связей пересчитывает зависимые хосты ЛЮБЫХ модулей, а пишет
   *  их владелец (I3). */
  dependentCellsByDepKey(key: string, tx?: TransactionClient): Promise<FormulaCellRef[]>;

  /** Ячейки по ПРЕФИКСУ ключа зависимости (`v:task:<id>:`,
   *  `system:task:<id>`): удалённый источник не оставляет протухших
   *  значений у потребителей — их хосты находятся без перебора всех ячеек. */
  dependentCellsByDepPrefix(prefix: string, tx?: TransactionClient): Promise<FormulaCellRef[]>;

  /** Все свои ячейки атрибута (смена привязок: атрибут отвязан/привязан —
   *  ячейки получают `attribute_unavailable` или снова считаются). */
  dependentCellsByField(fieldId: string, tx?: TransactionClient): Promise<FormulaCellRef[]>;

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

  /** Dry-run переноса (Р10, move-preview): какие формульные значения хостов
   *  изменятся, если записи окажутся в новом месте. Ничего не пишет.
   *  Считаются свои ячейки и действующие формулы типа/вида. */
  preview(
    hostKind: FormulaHostKind,
    hostIds: readonly string[],
    override: FormulaPreviewOverride,
    tx?: TransactionClient,
  ): Promise<FormulaPreviewEntry[]>;

  /** Вычисление произвольной формулы в контексте хоста без записи (префилл
   *  окна/создания, Р12). `actor` — проверка видимости хоста (Р7);
   *  `fieldId`/`fieldType` — материализация результата под тип слота. */
  evaluate(
    hostKind: FormulaHostKind,
    hostId: string,
    ast: FormulaNode,
    opts?: {
      actor?: ProjectActor;
      fieldId?: string;
      fieldType?: CustomFieldType;
      tx?: TransactionClient;
    },
  ): Promise<FormulaComputation>;

  /** Уборка ячеек удалённого/архивного хоста (Р4, «смерть связей»). */
  cleanupHost(tx: TransactionClient, hostKind: FormulaHostKind, hostId: string): Promise<void>;
}
