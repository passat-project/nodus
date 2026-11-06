import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  CORRESPONDENCE_EVENTS,
  CUSTOM_FIELD_EVENTS,
  customFieldDefinitionChangedPayloadSchema,
  letterRegisteredPayloadSchema,
  letterUpdatedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { LetterFormulaService } from '../letters/letter-formula.service.js';

/** Ключ атрибута в изменениях письма: `cf.<uuid>` (`custom-field-key.ts`). */
const CF_PREFIX = 'cf.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Партия массового пересчёта: одна транзакция на пачку хостов (Р4). */
const HOST_BATCH = 100;

/**
 * Пересчёт формул писем по зависимостям (#632, Р4/Р8). Триггер:
 * - `letter_updated` — значения атрибутов (`changes[].field = cf.<id>`) и
 *   системные поля (тема, номер, даты, корреспондент): пересчитываются
 *   ячейки письма и зависимые от его значений;
 * - `letter_registered` — окно регистрации пишет реквизиты и атрибуты без
 *   `letter_updated`: источники системных полей и значений сменились;
 * - `custom_field.definition_changed` — значение компании (`company:<n>`) и
 *   удаление атрибута (`attr_number = N`, Р13) — массовый пересчёт.
 *
 * Глубина волны: источник-ячейка задаёт глубину (аккумулятор recalc_depth),
 * ручная правка — 1; превышение лимита ставит `cycle` и останавливает волну
 * (Р8). Письма не входят в выборки агрегатов других хостов (В1), поэтому
 * каскад дальше своего письма не идёт.
 */
@Injectable()
export class LetterFormulaRecalcHandler {
  static readonly eventType = CORRESPONDENCE_EVENTS.LETTER_UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: LetterFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterFormulaRecalcHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = letterUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const payload = parsed.data;
    await this.txRunner.run(async (tx) => {
      const numbers: number[] = [];
      let sourceDepth = 0;
      for (const change of payload.changes) {
        if (!change.field.startsWith(CF_PREFIX)) continue;
        const fieldId = change.field.slice(CF_PREFIX.length);
        if (!UUID.test(fieldId)) continue;
        const number = await this.cells.numberByDefinitionId(fieldId, tx);
        if (number === null) continue;
        numbers.push(number);
        const depth = await this.cells.depthOf('letter', payload.letterId, fieldId, tx);
        if (depth !== null) sourceDepth = Math.max(sourceDepth, depth);
      }
      this.logger.debug({ letterId: payload.letterId, numbers }, 'Пересчёт формул письма');
      await this.formulas.recalcCells(
        tx,
        event.actorId ?? null,
        payload.letterId,
        numbers,
        sourceDepth + 1,
      );
    });
  }
}

/** Регистрация письма (#55): окно пишет реквизиты и значения атрибутов в
 *  своей транзакции, `letter_updated` при этом не эмитится — источники
 *  системных полей сменились, ячейки письма пересчитываются (Р4). */
@Injectable()
export class LetterFormulaRegisteredHandler {
  static readonly eventType = CORRESPONDENCE_EVENTS.LETTER_REGISTERED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: LetterFormulaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterFormulaRegisteredHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = letterRegisteredPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    this.logger.debug({ letterId: parsed.data.letterId }, 'Пересчёт формул после регистрации');
    await this.txRunner.run((tx) =>
      this.formulas.recalcCells(tx, event.actorId ?? null, parsed.data.letterId, [], 1),
    );
  }
}

/** Пересчёт по удалению атрибута и смене значения компании (Р13). */
@Injectable()
export class LetterFormulaDefinitionHandler {
  static readonly eventType = CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: LetterFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterFormulaDefinitionHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = customFieldDefinitionChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const payload = parsed.data;
    const companyChanged = payload.fields?.includes('companyValue') === true;
    const bindingsChanged = payload.fields?.includes('bindings') === true;
    const deleted = payload.change === 'deleted';
    if (!companyChanged && !bindingsChanged && !deleted) return;
    // Привязки сменились: свои ячейки атрибута пересчитываются (часть
    // писем осталась без привязки — `attribute_unavailable`).
    if (bindingsChanged && !deleted && !companyChanged) {
      const own = (await this.cells.dependentCellsByField(payload.definitionId)).filter(
        (cell) => cell.hostKind === 'letter',
      );
      const hosts = [...new Set(own.map((cell) => cell.hostId))];
      for (let index = 0; index < hosts.length; index += HOST_BATCH) {
        const batch = hosts.slice(index, index + HOST_BATCH);
        await this.txRunner.run(async (tx) => {
          for (const hostId of batch) {
            await this.formulas.recalcCells(tx, event.actorId ?? null, hostId, [], 1);
          }
        });
      }
      return;
    }
    // Удаление: строки определения уже нет — номер едет в payload (#632).
    const number = payload.number ?? (await this.cells.numberByDefinitionId(payload.definitionId));
    if (number === null) return;
    const cells = await this.cells.dependentCellsByAttrNumber(number);
    const hosts = [
      ...new Set(cells.filter((cell) => cell.hostKind === 'letter').map((cell) => cell.hostId)),
    ];
    if (hosts.length === 0) return;
    this.logger.debug({ number, hosts: hosts.length }, 'Массовый пересчёт формул писем');
    // Партии по 100 писем в отдельной транзакции: массовый пересчёт не
    // должен упираться в таймаут одной tx; повтор события идемпотентен.
    for (let index = 0; index < hosts.length; index += HOST_BATCH) {
      const batch = hosts.slice(index, index + HOST_BATCH);
      await this.txRunner.run(async (tx) => {
        for (const hostId of batch) {
          await this.formulas.recalcCells(tx, event.actorId ?? null, hostId, [number], 1);
        }
      });
    }
  }
}
