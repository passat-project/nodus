import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CUSTOM_FIELD_EVENTS,
  type AuthUser,
  type FormulaHostKind,
  type FormulaNode,
  type FormulaResponse,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  FORMULA_CELLS,
  type FormulaCellRef,
  type FormulaCells,
  type FormulaRecalcOutcome,
} from '../../custom-fields/ports/formula-cells.port.js';
import { letterAccessOf } from '../access/letter-access.js';
import { letterAudience, LetterFieldsWriter } from './letter-fields.writer.js';
import { LettersQueryService } from './letters-query.service.js';
import { LettersRepository } from './letters.repository.js';

/**
 * Формула ячейки письма (#632, Р10): мутации живут у владельца хоста (I3).
 * Порт `FORMULA_CELLS` проверяет формулу и хранит её, значение материализует
 * штатный писатель письма (Р4) — событие `letter_updated` с ключами `cf.<id>`
 * уезжает обычным путём, а `custom_field.formula_changed` (O4) — адресно
 * видимым письмо. Право — canEdit письма (`letterAccessOf`), как у правки
 * реквизитов: невидимое письмо отвечает 404 без оракула, чужое — 403.
 */
@Injectable()
export class LetterFormulaService {
  private readonly log = new Logger(LetterFormulaService.name);

  /** Потолок синхронного пересчёта в tx PATCH (#632): массовый каскад
   *  остаётся диспетчеру — tx пользователя не удлиняется. */
  private static readonly SYNC_RECALC_LIMIT = 20;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly query: LettersQueryService,
    private readonly repo: LettersRepository,
    private readonly fields: LetterFieldsWriter,
    private readonly eventBus: EventBus,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
  ) {}

  /** Эффективная формула ячейки для редактора: смотреть может любой зритель. */
  async read(user: AuthUser, letterId: string, fieldId: string): Promise<FormulaResponse> {
    await this.query.visibleRow(user, letterId);
    return this.cells.read('letter', letterId, fieldId);
  }

  /** Поставить/заменить свою формулу: проверка → запись → значение. */
  async save(
    user: AuthUser,
    letterId: string,
    fieldId: string,
    ast: FormulaNode,
  ): Promise<FormulaResponse> {
    await this.requireEdit(user, letterId);
    return this.txRunner.run(async (tx) => {
      // Порядок замков как у PATCH карточки: письмо → ячейки. Иначе
      // параллельные «правка значения» и «поставить формулу» берут строки в
      // разном порядке и ловят 40P01 вместо одного исхода (Р5).
      await this.repo.lock(tx, letterId);
      const outcome = await this.cells.save(tx, {
        hostKind: 'letter',
        hostId: letterId,
        fieldId,
        ast,
        actorId: user.id,
      });
      await this.fields.applyFormulaValues(tx, {
        letterId,
        values: { [fieldId]: outcome.value },
        actorId: user.id,
      });
      await this.emitChanged(tx, user.id, letterId, fieldId, outcome.error !== null);
      return { ast, origin: 'own' as const };
    });
  }

  /** Снять формулу (#660): вычисленное значение очищается — ячейка пуста
   *  или под формулой типа; «снимок» больше не остаётся. */
  async remove(user: AuthUser, letterId: string, fieldId: string): Promise<void> {
    await this.requireEdit(user, letterId);
    await this.txRunner.run(async (tx) => {
      await this.repo.lock(tx, letterId);
      await this.cells.remove(tx, { hostKind: 'letter', hostId: letterId, fieldId });
      await this.fields.applyFormulaValues(tx, {
        letterId,
        values: { [fieldId]: null },
        actorId: user.id,
      });
      await this.emitChanged(tx, user.id, letterId, fieldId, false);
    });
  }

  /**
   * Синхронный пересчёт ячеек письма в транзакции PATCH (#632): ответ
   * мутации несёт свежие значения — обработчик опаздывает на цикл
   * диспетчера, и карточка «отстаёт на шаг». Свыше лимита ячеек — пропуск.
   */
  async recalcAfterValuesChange(
    tx: TransactionClient,
    actorId: string | null,
    letterId: string,
    fieldIds: readonly string[],
  ): Promise<void> {
    const numbers: number[] = [];
    for (const fieldId of fieldIds) {
      const number = await this.cells.numberByDefinitionId(fieldId, tx);
      if (number !== null) numbers.push(number);
    }
    if (numbers.length === 0) return;
    const own = await this.cells.cellsForHost('letter', letterId, tx);
    const dependent = await this.cells.dependentCellsByValues('letter', letterId, numbers, tx);
    const total = new Set([...own, ...dependent].map((cell) => cell.cellId)).size;
    if (total === 0 || total > LetterFormulaService.SYNC_RECALC_LIMIT) return;
    await this.recalcCells(tx, actorId, letterId, numbers, 1);
  }

  /** Пересчёт ячеек письма после изменения значений (Р4): общая точка для
   *  обработчиков `letter_updated` / `letter_registered` / удаления атрибута.
   *  Ячейки письма пересчитываются всегда (формула может читать системные
   *  поля — тема, номер, даты), зависимые — по номерам изменённых атрибутов. */
  async recalcCells(
    tx: TransactionClient,
    actorId: string | null,
    letterId: string,
    numbers: readonly number[],
    depth: number,
  ): Promise<void> {
    const dependent =
      numbers.length > 0
        ? await this.cells.dependentCellsByValues('letter', letterId, numbers, tx)
        : [];
    const own = await this.cells.cellsForHost('letter', letterId, tx);
    const seen = new Set(dependent.map((cell) => cell.cellId));
    // Чужие хосты не пишем (I3): ячейка материализуется только в своём письме.
    const all = [...dependent, ...own.filter((cell) => !seen.has(cell.cellId))].filter(
      (cell) => cell.hostKind === 'letter' && cell.hostId === letterId,
    );
    if (all.length === 0) return;
    await this.repo.lock(tx, letterId);
    for (const cell of all) {
      const outcome = await this.recalcOrNull(tx, cell, depth);
      if (!outcome) continue;
      // Гашение каскада (Р8): неизменившееся значение событий не эмитит;
      // адресное formula_changed — только при смене наличия ошибки (O4).
      if (outcome.silent) continue;
      if (outcome.changed) {
        try {
          await this.fields.applyFormulaValues(tx, {
            letterId,
            values: { [cell.fieldId]: outcome.value },
            actorId,
          });
        } catch (error) {
          // Одна «ядовитая» ячейка не валит партию и не зацикливает событие.
          this.log.warn(
            `Формула письма ${letterId}/${cell.fieldId} не записана: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          continue;
        }
      }
      if (outcome.errorChanged) {
        await this.emitChanged(tx, actorId, letterId, cell.fieldId, outcome.error !== null);
      }
    }
  }

  /**
   * Пересчёт ячейки с изоляцией сбоя (Р4): падение чтения источника или
   * вычисления одной ячейки не валит транзакцию и не превращает событие в
   * вечный retry диспетчера — остальные ячейки письма пересчитываются.
   */
  private async recalcOrNull(
    tx: TransactionClient,
    cell: FormulaCellRef,
    depth: number,
  ): Promise<FormulaRecalcOutcome | null> {
    try {
      return await this.cells.recalc(tx, cell, depth);
    } catch (error) {
      this.log.warn(
        `Формула письма ${cell.hostId}/${cell.fieldId} не пересчитана: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** Право правки письма (как у PATCH реквизитов): канцелярия. Невидимое
   *  письмо — 404 без оракула (проверка видимости идёт первой). */
  private async requireEdit(user: AuthUser, letterId: string) {
    const row = await this.query.visibleRow(user, letterId);
    if (!letterAccessOf(user, row, false).canEdit) {
      throw DomainException.forbidden('Letter edit not allowed');
    }
    return row;
  }

  /** Адресное событие формулы (O4): без значений, только состояние ошибки. */
  private async emitChanged(
    tx: TransactionClient,
    actorId: string | null,
    letterId: string,
    fieldId: string,
    hasError: boolean,
  ): Promise<void> {
    const row = await this.repo.findDetailById(letterId, tx);
    if (!row) return;
    const participants = (await this.repo.participants(letterId, tx)).map(
      (participant) => participant.userId,
    );
    await this.eventBus.emit(
      tx,
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      {
        hostKind: 'letter' satisfies FormulaHostKind,
        hostId: letterId,
        fieldId,
        hasError,
        audience: letterAudience(row, participants),
      },
      { actorId: actorId ?? undefined, aggregateType: 'letter', aggregateId: letterId },
    );
  }
}
