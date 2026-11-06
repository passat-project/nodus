import { Inject, Injectable } from '@nestjs/common';
import {
  CORRESPONDENCE_EVENTS,
  ErrorCode,
  sameCustomFieldValue,
  type AuthUser,
  type LetterDetail,
  type UpdateLetterBody,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { FILE_STORAGE, type FileStorage } from '../../../core/ports/file-storage.port.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import { companyDate } from '../../../core/time/company-time.js';
import { canRegisterLetters, letterAccessOf } from '../access/letter-access.js';
import {
  LetterAttachedRefsRepository,
  type LetterAttachedRefInput,
} from './letter-attached-refs.repository.js';
import { LetterAttachedRefsValidator, sameAttachedRefs } from './letter-attached-refs.validator.js';
import { LetterFieldsValidator, type RegistrationValues } from './letter-fields.validator.js';
import { LetterFieldsWriter } from './letter-fields.writer.js';
import { LettersQueryService } from './letters-query.service.js';
import { LettersRepository } from './letters.repository.js';
import type { LetterDetailRow } from './letter-row.js';

/** Строка письма → значения регистрации: PATCH строит их под замком строки
 *  (#646), чтобы параллельная правка не потеряла чужие изменения. */
function registrationValuesOf(row: LetterDetailRow): RegistrationValues {
  return {
    counterpartyId: row.counterpartyId ?? '',
    signerId: row.signerId,
    theirNumber: row.theirNumber ?? '',
    theirDate: row.theirDate ? row.theirDate.toISOString().slice(0, 10) : '',
    subject: row.subject ?? '',
    receiptMethodId: row.receiptMethodId ?? '',
    projectId: row.projectId,
    addresseeId: row.addresseeId ?? '',
    responseDeadline: row.responseDeadline ? row.responseDeadline.toISOString().slice(0, 10) : null,
    // Правка не касается связей «ответ на» (Р5) — в RegistrationValues
    // поле присутствует, но PATCH его не меняет.
    replyToLetterId: null,
  };
}

/**
 * Мутации писем (#55): правка реквизитов (В3; редизайн #56 — и
 * незарегистрированного по месту в карточке; #461 — флаг конфиденциальности
 * и строки приложенных), удаление спама (Р12), присоединение к обсуждению
 * (Р10), приглашение коллеги и личный признак «просмотрено» (редизайн #56).
 * Все — в транзакциях вызывающего слоя; ручное создание с файлами —
 * `LettersManualCreateService`.
 */
@Injectable()
export class LettersMutationService {
  constructor(
    private readonly repo: LettersRepository,
    private readonly query: LettersQueryService,
    private readonly validator: LetterFieldsValidator,
    private readonly fields: LetterFieldsWriter,
    private readonly attached: LetterAttachedRefsRepository,
    private readonly attachedValidator: LetterAttachedRefsValidator,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
  ) {}

  /** `PATCH /letters/:id` — правка реквизитов письма канцелярией по месту в
   *  карточке (редизайн #56): незарегистрированное заполняется до регистрации,
   *  зарегистрированное — как раньше (В3). */
  async update(user: AuthUser, id: string, body: UpdateLetterBody): Promise<LetterDetail> {
    const row = await this.query.visibleRow(user, id);
    if (!canRegisterLetters(user)) {
      throw new DomainException(ErrorCode.LETTER_NOT_EDITABLE, 'Letter is not editable');
    }
    if (body.addresseeId !== undefined && row.registeredAt !== null) {
      // Адресат и номер не меняются после регистрации.
      throw new DomainException(ErrorCode.LETTER_NOT_EDITABLE, 'Addressee is not editable');
    }
    const today = companyDate(new Date());
    await this.txRunner.run(async (tx) => {
      // Read-modify-write `custom_fields` — только под замком строки (#646):
      // иначе два параллельных PATCH по разным атрибутам теряют значения
      // друг друга (у задач и проектов этот путь уже закрыт; письма — нет).
      await this.repo.lock(tx, id);
      const fresh = await this.repo.findDetailById(id, tx);
      if (!fresh || fresh.deletedAt !== null) throw DomainException.notFound('Letter not found');
      if (body.addresseeId !== undefined && fresh.registeredAt !== null) {
        throw new DomainException(ErrorCode.LETTER_NOT_EDITABLE, 'Addressee is not editable');
      }
      const { data, changes } = await this.validator.patch(
        registrationValuesOf(fresh),
        (fresh.customFields ?? {}) as Record<string, unknown>,
        body,
        fresh.typeId,
        today,
        user,
      );
      // Вписанное руками значение снимает формулу ячейки в той же tx
      // (Р5 #632): «зафиксировать» = вписать значение, «как у типа» = очистить.
      // Снимаем только РЕАЛЬНО изменённые ключи: Enter без правки формулу
      // не отменяет.
      const requested = body.customFields ?? {};
      await this.fields.releaseFormulas(
        tx,
        id,
        Object.keys(requested).filter(
          (fieldId) =>
            !sameCustomFieldValue(
              (fresh.customFields as Record<string, unknown> | null)?.[fieldId],
              requested[fieldId],
            ),
        ),
      );
      // «Приложенные письма» (#461, Р3): правка набором; история — счётчиком
      // строк, только если набор реально изменился.
      let attachedRows: LetterAttachedRefInput[] | null = null;
      if (body.attachedRefs !== undefined) {
        const next = await this.attachedValidator.validate(body.attachedRefs);
        const before = await this.attached.attachedRefs(id);
        // Набор не изменился (правились другие поля, окно прислало то же) —
        // строки не пересоздаём: delete+insert менял бы id и писал лишнее.
        if (!sameAttachedRefs(before, next)) {
          attachedRows = next;
          changes.push({
            field: 'attachedRefs',
            from: String(before.length),
            to: String(next.length),
          });
        }
      }
      // «Конфиденциально» (#461, Р4): флаг в карточке; история — «Да/Нет».
      if (body.confidential !== undefined && body.confidential !== fresh.confidential) {
        changes.push({
          field: 'confidential',
          from: String(fresh.confidential),
          to: String(body.confidential),
        });
      }
      if (changes.length === 0) return;
      // Эффективный подписант: смена корреспондента могла сбросить его в null
      // (валидатор), и проекция CRM не должна оставить чужой контакт.
      const signerChange = changes.find((change) => change.field === 'signerId');
      await this.repo.update(tx, id, {
        ...data,
        ...(body.confidential === undefined ? {} : { confidential: body.confidential }),
      });
      if (attachedRows !== null) await this.attached.replace(tx, id, attachedRows);
      await this.eventBus.emit(
        tx,
        CORRESPONDENCE_EVENTS.LETTER_UPDATED,
        {
          letterId: id,
          changes,
          ...(body.counterpartyId !== undefined ? { counterpartyId: body.counterpartyId } : {}),
          ...(signerChange ? { signerId: signerChange.to as string | null } : {}),
        },
        { actorId: user.id, aggregateType: 'letter', aggregateId: id },
      );
    });
    return this.query.detail(user, id);
  }

  /** `DELETE /letters/:id` — спам из «Новые» (Р12 + надгробие #56, Р13):
   *  файлы и вложения сносятся физически, строка письма живёт с deleted_at и
   *  Message-ID — повторный импорт удалённого (сброс UIDVALIDITY, полный
   *  переобход) не возвращает мусор в «Новые». */
  async deleteSpam(user: AuthUser, id: string): Promise<void> {
    const row = await this.query.visibleRow(user, id);
    if (!letterAccessOf(user, row, false).canDeleteSpam) {
      throw new DomainException(ErrorCode.LETTER_NOT_DELETABLE, 'Letter is not deletable');
    }
    const fileIds = await this.repo.fileIds(id);
    await this.txRunner.run(async (tx) => {
      await this.repo.lock(tx, id);
      await this.repo.tombstone(tx, id);
      await this.eventBus.emit(
        tx,
        CORRESPONDENCE_EVENTS.LETTER_DELETED,
        { letterId: id },
        { actorId: user.id, aggregateType: 'letter', aggregateId: id },
      );
    });
    // После коммита: файлы письма больше никому не нужны (best-effort).
    await this.storage.remove(fileIds).catch(() => undefined);
  }

  /** `POST /letters/:id/join` — «Присоединиться к обсуждению» (идемпотентно).
   *  Канцелярия может «начать обсуждение» и до регистрации (редизайн #56),
   *  остальным — только зарегистрированное письмо. */
  async join(user: AuthUser, id: string): Promise<LetterDetail> {
    const row = await this.query.visibleRow(user, id);
    const participants = await this.repo.participants(id);
    const isParticipant =
      participants.some((participant) => participant.userId === user.id) ||
      row.addresseeId === user.id;
    // У конфиденциального «Присоединиться» может только регистратор ЭТОГО
    // письма или держатель права (#461, Р4): прочая канцелярия письма не
    // видит, а участнику присоединяться незачем.
    if (!letterAccessOf(user, row, isParticipant).canJoin) {
      throw DomainException.notFound('Letter is not joinable');
    }
    await this.addOneParticipant(user, id, user.id);
    return this.query.detail(user, id);
  }

  /** Личное присоединение — одиночная вставка (join). */
  private async addOneParticipant(user: AuthUser, id: string, userId: string): Promise<void> {
    await this.txRunner.run(async (tx) => {
      await this.repo.lock(tx, id);
      const created = await this.repo.addParticipant(tx, id, userId);
      if (created) {
        await this.eventBus.emit(
          tx,
          CORRESPONDENCE_EVENTS.LETTER_PARTICIPANTS_CHANGED,
          { letterId: id, added: [userId], removed: [] },
          { actorId: user.id, aggregateType: 'letter', aggregateId: id },
        );
      }
    });
  }

  /** `POST /letters/:id/participants` — пригласить коллег в обсуждение
   *  (редизайн #56; пачка — приёмка 28.10): только канцелярия (гуард
   *  контроллера), письмо в любом состоянии; повторные приглашения — не
   *  ошибка, просто текущий состав. Событие состава — одно на пачку. */
  async addParticipants(user: AuthUser, id: string, userIds: string[]): Promise<LetterDetail> {
    await this.query.visibleRow(user, id);
    const active = await this.profiles.filterActiveUserIds(userIds);
    if (active.length !== userIds.length) {
      throw DomainException.notFound('User not found');
    }
    const added: string[] = [];
    await this.txRunner.run(async (tx) => {
      await this.repo.lock(tx, id);
      for (const userId of userIds) {
        if (await this.repo.addParticipant(tx, id, userId)) added.push(userId);
      }
      if (added.length > 0) {
        await this.eventBus.emit(
          tx,
          CORRESPONDENCE_EVENTS.LETTER_PARTICIPANTS_CHANGED,
          { letterId: id, added, removed: [] },
          { actorId: user.id, aggregateType: 'letter', aggregateId: id },
        );
      }
    });
    return this.query.detail(user, id);
  }

  /** `POST /letters/:id/view` — личный признак «просмотрено» (редизайн #56):
   *  не бизнес-действие — без аудита и события; идемпотентен. */
  async markViewed(user: AuthUser, id: string): Promise<void> {
    await this.query.visibleRow(user, id);
    await this.repo.markViewed(id, user.id);
  }
}
