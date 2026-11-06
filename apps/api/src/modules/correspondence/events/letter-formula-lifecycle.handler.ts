import { Inject, Injectable } from '@nestjs/common';
import {
  CORRESPONDENCE_EVENTS,
  letterDeletedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';

/**
 * Удаление письма (#632, Р4): его ячейки-формулы и зависимости умирают
 * вместе с хостом. Без этого осиротевшие `formula_cells`/`formula_deps`
 * остаются навсегда (письмо мягко удалено, пересчёт его уже не найдёт) и
 * могут «ожить» при восстановлении из корзины со старой формулой.
 */
@Injectable()
export class LetterFormulaLifecycleHandler {
  static readonly eventType = CORRESPONDENCE_EVENTS.LETTER_DELETED;

  constructor(
    private readonly txRunner: TransactionRunner,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
  ) {}

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = letterDeletedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    await this.txRunner.run((tx) => this.cells.cleanupHost(tx, 'letter', parsed.data.letterId));
  }
}
