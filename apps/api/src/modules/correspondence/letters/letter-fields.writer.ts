import { Inject, Injectable } from '@nestjs/common';
import {
  CORRESPONDENCE_EVENTS,
  CUSTOM_FIELD_LIMITS,
  type CustomFieldValue,
  type CustomFieldValues,
} from '@nodus/contracts';

import type { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
  type RegistryFieldChange,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import type { LetterDetailRow } from './letter-row.js';
import { LettersRepository } from './letters.repository.js';

/**
 * Кто видит письмо — адресаты адресного события формулы (#632, O4).
 * Круг тот же, что у `canViewLetter`: участники обсуждения, регистратор,
 * адресат и автор; каталожный broadcast раскрывал бы hostId конфиденциального
 * письма всем сокетам, поэтому событие уходит только им.
 */
export function letterAudience(
  row: Pick<LetterDetailRow, 'registrarId' | 'addresseeId' | 'createdBy'>,
  participants: readonly string[],
): string[] {
  return [
    ...new Set([
      ...participants,
      ...(row.registrarId ? [row.registrarId] : []),
      ...(row.addresseeId ? [row.addresseeId] : []),
      row.createdBy,
    ]),
  ];
}

/** Значение в событии: длинный текст обрезается лимитом события (Р12). */
function eventSafeValue(value: CustomFieldValue | null): CustomFieldValue | null {
  return typeof value === 'string' && value.length > CUSTOM_FIELD_LIMITS.eventText
    ? value.slice(0, CUSTOM_FIELD_LIMITS.eventText)
    : value;
}

/**
 * Единый писатель значений атрибутов письма (#632, Р4): письма, в отличие
 * от задач, отдельного writer'а не имели — значения писались прямо из
 * валидатора окна и PATCH-сервиса. Семантики формул:
 *
 * - **формульная ячейка руками не пишется** (решение владельца по #660):
 *   `lockedFieldIds` — ключи атрибутов со своей формулой или формулой
 *   места; окно регистрации фильтрует их до записи, PATCH-сервис на
 *   попытку записи отвечает 422 FORMULA_CELL_LOCKED;
 * - **запись результата формулы** (Р4): материализация через реестр
 *   (`trusted` — значение уже отфильтровано Р7 на источниках, повторная
 *   проверка видимости актёром невозможна) + событие хоста
 *   `letter_updated` с ключами `cf.<id>` — событие уезжает обычным путём,
 *   а I3 не нарушается: `custom_fields` письма пишет его владелец.
 */
@Injectable()
export class LetterFieldsWriter {
  constructor(
    private readonly repo: LettersRepository,
    private readonly eventBus: EventBus,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly registry: CustomFieldRegistry,
    @Inject(FORMULA_CELLS) private readonly formulaCells: FormulaCells,
  ) {}

  /** Ключи формульно-заблокированных атрибутов письма (#660): значение
   *  пишет только формула — своя или привязки места. */
  async lockedFieldIds(
    tx: TransactionClient,
    letterId: string,
    fieldIds: readonly string[],
  ): Promise<Set<string>> {
    if (fieldIds.length === 0) return new Set();
    return this.formulaCells.lockedFieldIds(tx, 'letter', letterId, fieldIds);
  }

  /** Материализация вычисленных формулой значений (Р4): замок строки →
   *  слияние по ключам через реестр → запись → событие письма. Пустой
   *  результат изменений не даёт события (шум-контроль каскада, Р8). */
  async applyFormulaValues(
    tx: TransactionClient,
    args: {
      letterId: string;
      values: Record<string, CustomFieldValue | null>;
      actorId: string | null;
    },
  ): Promise<RegistryFieldChange[]> {
    if (Object.keys(args.values).length === 0) return [];
    // Read-modify-write `custom_fields` — под замком строки, как PATCH
    // карточки (#646): параллельные правки сливаются по ключам.
    await this.repo.lock(tx, args.letterId);
    const fresh = await this.repo.findDetailById(args.letterId, tx);
    if (!fresh || fresh.deletedAt !== null) return [];
    const prepared = await this.registry.prepareUpdate(
      {
        current: (fresh.customFields ?? {}) as CustomFieldValues,
        patch: args.values,
        // У системного пересчёта нет пользователя: актёр — автор письма,
        // а видимость значений-ссылок уже проверена на источниках (Р7).
        actor: { id: args.actorId ?? fresh.createdBy, permissions: [] },
        target: { kind: 'process_type', id: fresh.typeId },
        trusted: true,
      },
      tx,
    );
    if (prepared.changes.length === 0) return [];
    await this.repo.update(tx, args.letterId, {
      customFields: prepared.next as Prisma.InputJsonValue,
    });
    await this.eventBus.emit(
      tx,
      CORRESPONDENCE_EVENTS.LETTER_UPDATED,
      {
        letterId: args.letterId,
        changes: prepared.changes.map((change) => ({
          field: `cf.${change.fieldId}`,
          from: eventSafeValue(change.from),
          to: eventSafeValue(change.to),
        })),
      },
      {
        actorId: args.actorId ?? undefined,
        aggregateType: 'letter',
        aggregateId: args.letterId,
      },
    );
    return prepared.changes;
  }
}
