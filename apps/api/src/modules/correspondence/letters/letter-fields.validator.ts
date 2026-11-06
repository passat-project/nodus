import { Inject, Injectable } from '@nestjs/common';
import {
  checkLetterDates,
  ErrorCode,
  letterRegistrationInputSchema,
  letterRegistrationIssueSchema,
  SystemDictionary,
  type LetterAttachedRefInput,
  type LetterRegistrationField,
  type LetterRegistrationInput,
  type LetterRegistrationIssue,
  type CustomFieldValues,
  type UpdateLetterBody,
} from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import {
  COUNTERPARTY_READER,
  type CounterpartyReader,
} from '../../crm/ports/counterparty-reader.port.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import {
  DICTIONARY_READER,
  type DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';

/** Проверенные значения регистрации — то, что пишется в письмо. */
export interface RegistrationValues {
  counterpartyId: string;
  signerId: string | null;
  theirNumber: string;
  theirDate: string;
  subject: string;
  receiptMethodId: string;
  projectId: string | null;
  /** До регистрации адресата может не быть (редизайн #56: поле заполняется
   *  по месту в карточке); регистрация требует его заполненным. */
  addresseeId: string | null;
  responseDeadline: string | null;
  /** Подтверждение подсказки «ответ на» (#56, Р5): семантика — в апликере. */
  replyToLetterId: string | null;
}

/** Поля регистрации вне карточки-формы (#461): флаг и строки приложенных —
 *  апликер валидирует строки и пишет их набором в той же транзакции.
 *  null — поле не передано (не трогаем уже сохранённое карточкой). */
export interface RegistrationExtra {
  confidential: boolean | null;
  attachedRefs: LetterAttachedRefInput[] | null;
}

/** Изменение поля для события/истории (значения — сырые: id, ISO-дата). */
export interface LetterFieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

const fail = (issue: LetterRegistrationIssue): never => {
  throw new DomainException(
    ErrorCode.LETTER_REGISTRATION_INVALID,
    'Letter registration is invalid',
    {
      field: issue.field,
      reason: issue.reason,
    },
  );
};

/**
 * Проверка регистрационных данных письма (#55, Р11): одна грамматика для
 * регистрации (окно «Зарегистрировать») и правки карточки (В3). Ссылки
 * проверяются портами: корреспондент — живой, подписант — действующий контакт
 * ИМЕННО этого корреспондента, способ поступления — активный элемент
 * системного справочника, адресат — действующий сотрудник. Атрибуты —
 * через реестр (#431), как у задач.
 */
@Injectable()
export class LetterFieldsValidator {
  constructor(
    @Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader,
    @Inject(DICTIONARY_READER) private readonly dictionaries: DictionaryReader,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
  ) {}

  /** Регистрация: обязательные поля окна + даты + ссылки + атрибуты.
   *
   *  `current` — значения атрибутов, уже стоящие у черновика (PATCH до
   *  регистрации разрешён): они база, ввод окна их перекрывает, умолчания
   *  заполняют только пустое. Иначе регистрация затирала бы поставленное
   *  заранее (#646). */
  async registration(
    typeId: string,
    input: unknown,
    actor: { id: string; permissions: readonly string[] },
    today: string,
    current: CustomFieldValues = {},
  ): Promise<{
    values: RegistrationValues;
    extra: RegistrationExtra;
    customFields: Record<string, unknown>;
  }> {
    const parsed = letterRegistrationInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      fail({
        field: (issue.path[0] as LetterRegistrationField | undefined) ?? 'counterpartyId',
        reason:
          issue.code === 'invalid_type' || issue.code === 'too_small' ? 'required' : 'invalid',
      });
    }
    const value: LetterRegistrationInput = parsed.data!;
    await this.assertLinks(value, today);
    // Проект (#52 Р5): существует и не в архиве; видимость регистратора не
    // требуется — служебное действие канцелярии, DTO фильтрует смотрящим.
    if (value.projectId) await this.projects.assertProjectAttachable(value.projectId);
    const customFields = await this.customFields.prepareCreate({
      input: { ...current, ...(value.customFields ?? {}) },
      // Автор умолчаний «подразделение автора» — сам актор регистрации.
      authorId: actor.id,
      actor,
      target: { kind: 'process_type', id: typeId },
    });
    return {
      values: {
        counterpartyId: value.counterpartyId,
        signerId: value.signerId,
        theirNumber: value.theirNumber,
        theirDate: value.theirDate,
        subject: value.subject,
        receiptMethodId: value.receiptMethodId,
        projectId: value.projectId,
        addresseeId: value.addresseeId,
        responseDeadline: value.responseDeadline,
        replyToLetterId: value.replyToLetterId ?? null,
      },
      extra: {
        confidential: value.confidential ?? null,
        attachedRefs: value.attachedRefs ?? null,
      },
      customFields,
    };
  }

  /**
   * Правка (В3; редизайн #56 — и незарегистрированного письма): проверяются
   * только переданные поля; номер не меняется вовсе, адресат — только до
   * регистрации (этот инвариант держит сервис). Смена корреспондента без
   * подписанта сбрасывает подписанта, если он больше не контакт нового
   * корреспондента.
   */
  async patch(
    current: RegistrationValues,
    currentCustomFields: Record<string, unknown>,
    body: UpdateLetterBody,
    typeId: string,
    today: string,
    actor: { id: string; permissions: readonly string[] },
  ): Promise<{ data: Record<string, unknown>; changes: LetterFieldChange[] }> {
    const next: RegistrationValues = { ...current };
    const changes: LetterFieldChange[] = [];
    const set = (field: keyof RegistrationValues, value: string | null): void => {
      if (next[field] === value) return;
      changes.push({ field, from: next[field], to: value });
      (next as unknown as Record<string, unknown>)[field] = value;
    };

    if (body.counterpartyId !== undefined) {
      const ref = await this.counterparties.activeRef(body.counterpartyId);
      if (!ref) fail({ field: 'counterpartyId', reason: 'not_found' });
      set('counterpartyId', body.counterpartyId);
      if (body.signerId === undefined && next.signerId) {
        const kept = await this.counterparties.activeContact(body.counterpartyId, next.signerId);
        if (!kept) set('signerId', null);
      }
    }
    if (body.signerId !== undefined) {
      if (body.signerId !== null) {
        const contact = await this.counterparties.activeContact(next.counterpartyId, body.signerId);
        if (!contact) fail({ field: 'signerId', reason: 'not_of_counterparty' });
      }
      set('signerId', body.signerId);
    }
    if (body.theirNumber !== undefined) set('theirNumber', body.theirNumber);
    if (body.subject !== undefined) set('subject', body.subject);
    if (body.projectId !== undefined) {
      // Тот же предикат регистрации (#52 Р5): живой не-архивный проект.
      if (body.projectId) await this.projects.assertProjectAttachable(body.projectId);
      set('projectId', body.projectId);
    }
    if (body.theirDate !== undefined) {
      this.assertDates({ theirDate: body.theirDate }, today);
      set('theirDate', body.theirDate);
    }
    if (body.responseDeadline !== undefined) {
      this.assertDates({ responseDeadline: body.responseDeadline }, today);
      set('responseDeadline', body.responseDeadline);
    }
    if (body.receiptMethodId !== undefined) {
      await this.assertReceiptMethod(body.receiptMethodId);
      set('receiptMethodId', body.receiptMethodId);
    }
    if (body.addresseeId !== undefined) {
      await this.assertAddressee(body.addresseeId);
      set('addresseeId', body.addresseeId);
    }

    const data: Record<string, unknown> = {};
    for (const change of changes) {
      const field = change.field as keyof RegistrationValues;
      const value = next[field];
      data[field] = field === 'theirDate' || field === 'responseDeadline' ? asDate(value) : value;
    }
    if (body.customFields !== undefined) {
      const prepared = await this.customFields.prepareUpdate({
        current: currentCustomFields as CustomFieldValues,
        patch: body.customFields,
        actor,
        target: { kind: 'process_type', id: typeId },
      });
      data.customFields = prepared.next;
      for (const change of prepared.changes) {
        changes.push({
          field: `cf.${change.fieldId}`,
          from: change.from,
          to: change.to,
        });
      }
    }
    return { data, changes };
  }

  private async assertLinks(value: LetterRegistrationInput, today: string): Promise<void> {
    this.assertDates(value, today);
    const counterparty = await this.counterparties.activeRef(value.counterpartyId);
    if (!counterparty) fail({ field: 'counterpartyId', reason: 'not_found' });
    if (value.signerId !== null) {
      const contact = await this.counterparties.activeContact(value.counterpartyId, value.signerId);
      if (!contact) fail({ field: 'signerId', reason: 'not_of_counterparty' });
    }
    await this.assertReceiptMethod(value.receiptMethodId);
    await this.assertAddressee(value.addresseeId);
    if (value.responseDeadline && value.responseDeadline.length > 10) {
      fail({ field: 'responseDeadline', reason: 'invalid' });
    }
  }

  private assertDates(
    input: { theirDate?: string | null; responseDeadline?: string | null },
    today: string,
  ): void {
    const issue = checkLetterDates(input, today)[0];
    if (issue) fail(letterRegistrationIssueSchema.parse(issue));
  }

  private async assertReceiptMethod(itemId: string): Promise<void> {
    const dictionaryId = await this.dictionaries.dictionaryIdByCode(
      SystemDictionary.RECEIPT_METHOD,
    );
    const item = dictionaryId ? await this.dictionaries.activeItemRef(dictionaryId, itemId) : null;
    if (!item) fail({ field: 'receiptMethodId', reason: 'not_found' });
  }

  /** Адресат — действующий сотрудник (как при регистрации); null — очистить
   *  поле до регистрации, окно «Зарегистрировать» поймает пустое. */
  private async assertAddressee(addresseeId: string | null): Promise<void> {
    if (addresseeId === null) return;
    const active = await this.profiles.filterActiveUserIds([addresseeId]);
    if (active.length === 0) fail({ field: 'addresseeId', reason: 'inactive' });
  }
}

/** ISO-дата → Date для колонки DATE (полночь UTC — контракт DTO). */
export function asDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}
