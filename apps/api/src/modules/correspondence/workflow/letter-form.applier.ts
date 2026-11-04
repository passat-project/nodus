import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@nodus/contracts';

import type { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type { WorkflowFormApplied } from '../../../core/ports/workflow-entity.port.js';
import { canViewLetter } from '../access/letter-access.js';
import { companyDate } from '../../../core/time/company-time.js';
import { LetterAttachedRefsRepository } from '../letters/letter-attached-refs.repository.js';
import { LetterAttachedRefsValidator } from '../letters/letter-attached-refs.validator.js';
import type { LetterDetailRow } from '../letters/letter-row.js';
import { LetterThreadingService } from '../letters/letter-threading.service.js';
import { LettersRepository } from '../letters/letters.repository.js';
import { LetterFieldsValidator, asDate } from '../letters/letter-fields.validator.js';

const EMPTY: WorkflowFormApplied = { fields: {}, timeEntryId: null, result: null };

const isoOf = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

/** 422 подтверждения связи «ответ на» (#56, Р5). */
const relationFail = (reason: 'not_found' | 'not_outgoing_registered' | 'suggestion_mismatch') =>
  new DomainException(ErrorCode.LETTER_RELATION_INVALID, 'Letter relation is invalid', {
    field: 'replyToLetterId',
    reason,
  });

/**
 * Применение окна «Регистрация» (#55, Р1; #56 — связь «ответ на»): проверка
 * тех же полей, что у формы, и запись реквизитов в письмо. Номер письма здесь
 * НЕ ставится — его выдаёт движок пост-действием `assign_number` и передаёт
 * адаптеру в `meta.numbering` (транзакция одна). Подтверждённая подсказка
 * «ответ на» — только свежая цель-исходящее (произвольные связи — #461),
 * вставка идемпотентна (частичный unique «один reply_to»).
 */
@Injectable()
export class LetterFormApplier {
  constructor(
    private readonly letters: LettersRepository,
    private readonly validator: LetterFieldsValidator,
    private readonly threading: LetterThreadingService,
    private readonly attached: LetterAttachedRefsRepository,
    private readonly attachedValidator: LetterAttachedRefsValidator,
  ) {}

  async apply(
    tx: TransactionClient,
    letter: LetterDetailRow,
    actor: { id: string; permissions: readonly string[] },
    input: { registration?: unknown },
  ): Promise<WorkflowFormApplied> {
    if (!input.registration) return EMPTY;
    const today = companyDate(new Date());
    const { values, extra, customFields } = await this.validator.registration(
      letter.typeId,
      input.registration,
      actor,
      today,
    );
    // «Основной документ письма» (#56): у письма с файлами-кандидатами один
    // обязан быть выбран звездой — номер присваивается конкретному документу
    // (главный де-факто: main или PDF-копия тела).
    const attachments = await this.letters.attachments(letter.id, tx);
    const candidates = attachments.filter(
      (a) => !a.inline && a.role !== 'source' && a.role !== 'body',
    );
    const hasMain = attachments.some((a) => a.role === 'main' || a.role === 'body_pdf');
    if (candidates.length > 0 && !hasMain) {
      throw new DomainException(
        ErrorCode.LETTER_REGISTRATION_INVALID,
        'Main document is required',
        {
          field: 'mainDocument',
          reason: 'required',
        },
      );
    }
    const fields: WorkflowFormApplied['fields'] = {};
    const diff = (field: string, from: unknown, to: unknown): void => {
      if (String(from ?? '') === String(to ?? '')) return;
      fields[field] = { from, to };
    };
    diff('counterpartyId', letter.counterpartyId, values.counterpartyId);
    diff('signerId', letter.signerId, values.signerId);
    diff('theirNumber', letter.theirNumber, values.theirNumber);
    diff('theirDate', isoOf(letter.theirDate), values.theirDate);
    diff('subject', letter.subject, values.subject);
    diff('receiptMethodId', letter.receiptMethodId, values.receiptMethodId);
    diff('projectId', letter.projectId, values.projectId);
    diff('addresseeId', letter.addresseeId, values.addresseeId);
    diff('responseDeadline', isoOf(letter.responseDeadline), values.responseDeadline);

    // «Приложенные письма» и флаг (#461): строки валидируются и пишутся
    // набором в этой же транзакции; не переданное поле не трогает карточку.
    const attachedRows =
      extra.attachedRefs === null
        ? null
        : await this.attachedValidator.validate(extra.attachedRefs);
    await this.letters.update(tx, letter.id, {
      counterpartyId: values.counterpartyId,
      signerId: values.signerId,
      theirNumber: values.theirNumber,
      theirDate: asDate(values.theirDate),
      subject: values.subject,
      receiptMethodId: values.receiptMethodId,
      projectId: values.projectId,
      addresseeId: values.addresseeId,
      responseDeadline: asDate(values.responseDeadline),
      customFields: customFields as Prisma.InputJsonValue,
      ...(extra.confidential === null ? {} : { confidential: extra.confidential }),
    });
    if (attachedRows !== null) await this.attached.replace(tx, letter.id, attachedRows);

    if (values.replyToLetterId) {
      await this.confirmReplyTo(tx, letter, values.replyToLetterId, today, actor);
    }
    return { fields, timeEntryId: null, result: null };
  }

  private async visibleToActor(
    actor: { id: string; permissions: readonly string[] },
    letterId: string,
  ): Promise<boolean> {
    const row = await this.letters.findDetailById(letterId);
    if (!row || row.deletedAt !== null) return false;
    const members = row.confidential
      ? new Set(
          (await this.letters.participants(letterId)).map((participant) => participant.userId),
        )
      : undefined;
    return canViewLetter(actor, row, members);
  }

  /** Галочка Вики подтверждает подсказку — цель обязана быть свежей
   *  подсказкой сервера (зарегистрированное исходящее по теме). */
  private async confirmReplyTo(
    tx: TransactionClient,
    letter: LetterDetailRow,
    replyToLetterId: string,
    today: string,
    actor: { id: string; permissions: readonly string[] },
  ): Promise<void> {
    const target = await this.letters.replyTargetById(tx, replyToLetterId);
    if (!target) throw relationFail('not_found');
    // Конфиденциальное исходящее вне участия регистратора не связывается и не
    // подтверждается: подсказка такого письма не показывается (#461, Р4).
    const members = target.confidential
      ? new Set(
          (await this.letters.participants(replyToLetterId)).map(
            (participant) => participant.userId,
          ),
        )
      : undefined;
    if (!canViewLetter(actor, target, members)) throw relationFail('not_found');
    if (target.direction !== 'outgoing' || target.registeredAt === null) {
      throw relationFail('not_outgoing_registered');
    }
    const existing = await this.letters.hasReplyTo(tx, letter.id);
    const suggestion = await this.threading.suggestionBySubject(letter.subject, today);
    // Невидимая регистратору подсказка (конфиденциальное исходящее вне
    // участия) не участвует в сверке — иначе ответ различал бы её
    // существование (`suggestion_mismatch` вместо `not_found`, #461).
    if (suggestion && !(await this.visibleToActor(actor, suggestion.id))) {
      throw relationFail('not_found');
    }
    if (existing || suggestion?.id !== replyToLetterId) {
      throw relationFail('suggestion_mismatch');
    }
    await this.letters.linkReplyTo(tx, letter.id, replyToLetterId, 'manual');
  }
}
