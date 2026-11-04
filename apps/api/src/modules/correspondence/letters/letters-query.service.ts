import { Inject, Injectable } from '@nestjs/common';
import {
  LETTER_LIMITS,
  Permission,
  type AuthUser,
  type LetterDetail,
  type LetterListItem,
  type ListLettersQuery,
  type Paginated,
  type UserRef,
} from '@nodus/contracts';
import { z } from 'zod';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { companyDate } from '../../../core/time/company-time.js';
import { decodeCursor, encodeCursor } from '../../../core/pagination/cursor.util.js';
import {
  ROLE_MEMBERSHIP_READER,
  type RoleMembershipReader,
} from '../../../core/ports/role-membership.port.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  COUNTERPARTY_READER,
  type CounterpartyReader,
} from '../../crm/ports/counterparty-reader.port.js';
import {
  canRegisterLetters,
  canViewConfidential,
  canViewLetter,
  letterAccessOf,
} from '../access/letter-access.js';
import { LetterAttachedRefsRepository } from './letter-attached-refs.repository.js';
import { LetterDtoMapper } from './letter-dto.mapper.js';
import { LetterThreadingService } from './letter-threading.service.js';
import type { LetterCursor, LetterDetailRow } from './letter-row.js';
import { LettersRepository, listOrderOf } from './letters.repository.js';

const cursorSchema = z.object({ at: z.string().min(1), id: z.uuid() });

/** Поиск по корреспонденту: сколько контрагентов подмешивать в OR (штат ~сотни). */
const SEARCH_COUNTERPARTIES = 50;

/**
 * Чтения писем (#55; #56 — конверт, связи «ответ на», подсказки): «Новые»,
 * «Входящие», «Исходящие», карточка и адресаты «Принимают решения».
 * Видимость — одна функция `letter-access.ts` (Р7): незарегистрированное
 * письмо чужому — 404, `box=new` без права — 403. Надгробия спама (Р13) не
 * видны ни в списках, ни в карточке — дедуп приёма читает их мимо репозитория.
 */
@Injectable()
export class LettersQueryService {
  constructor(
    private readonly repo: LettersRepository,
    private readonly attached: LetterAttachedRefsRepository,
    private readonly mapper: LetterDtoMapper,
    private readonly threading: LetterThreadingService,
    @Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader,
    @Inject(ROLE_MEMBERSHIP_READER) private readonly membership: RoleMembershipReader,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
  ) {}

  async list(user: AuthUser, q: ListLettersQuery): Promise<Paginated<LetterListItem>> {
    if (q.box === 'new' && !canRegisterLetters(user)) {
      throw DomainException.forbidden('Letter registration permission required');
    }
    const where = {
      AND: [
        this.boxWhere(q),
        ...(q.counterpartyId ? [{ counterpartyId: q.counterpartyId }] : []),
        // Конфиденциальные вне круга зрителя строки не дают (#461, Р4):
        // фильтр тот же, что у карточки, — по индексам адресата и участников.
        ...(q.box === 'new' ? [] : [this.confidentialityWhere(user)]),
        ...(await this.searchWhere(q.search)),
      ],
    };
    const after = q.cursor ? (decodeCursor(q.cursor, cursorSchema) as LetterCursor) : undefined;
    const rows = await this.repo.list(where, listOrderOf(q.box), after, q.limit);
    const page = rows.slice(0, q.limit);
    const ids = page.map((row) => row.id);
    const [counts, viewed] = await Promise.all([
      this.repo.attachmentCounts(ids),
      // Личный индикатор «я ещё не открывал» (редизайн #56).
      this.repo.viewedLetterIds(user.id, ids),
    ]);
    // Бейджи «Ответ на …» в строке очереди «Новые» (#56, Р5).
    const replyTos = await this.repo.replyTos(ids);
    const last = page[page.length - 1];
    const axis = listOrderOf(q.box);
    return {
      items: await this.mapper.toListItems(page, counts, user, replyTos, viewed),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ at: last[axis]!.toISOString(), id: last.id })
          : null,
    };
  }

  /** Карточка: видимость → права → DTO (ссылки и файлы только видимому).
   *  Подсказки (#56) — динамика чтения: контакт могут завести позже (Р6),
   *  тема меняется правкой — ничего не копим в письме. */
  async detail(
    user: AuthUser,
    id: string,
    today: string = companyDate(new Date()),
  ): Promise<LetterDetail> {
    const row = await this.visibleRow(user, id);
    const participants = await this.repo.participants(id);
    const isParticipant =
      participants.some((p) => p.userId === user.id) || row.addresseeId === user.id;
    const attachments = await this.repo.attachments(id);
    const attachedRefs = await this.attached.attachedRefs(id);
    const replyTo = await this.repo.replyTo(id);
    const [replySuggestion, counterpartySuggestion] = await Promise.all([
      // Подсказка живёт, только пока связи нет; актуальна до регистрации.
      replyTo || row.registeredAt
        ? Promise.resolve(null)
        : this.threading.suggestionBySubject(row.subject, today),
      row.counterpartyId || !row.mailFromAddress
        ? Promise.resolve(null)
        : this.counterpartySuggestionOf(row.mailFromAddress),
    ]);
    return this.mapper.toDetail(row, attachments, letterAccessOf(user, row, isParticipant), user, {
      replyTo,
      replySuggestion,
      counterpartySuggestion,
      attachedRefs,
    });
  }

  /** Письмо, видимое сотруднику, или 404 (невидимое = «не найдено», Р7).
   *  У конфиденциального состав обсуждения читается ДО проверки (#461, Р4):
   *  участник видит письмо, прочий сотрудник — 404 без оракула. */
  async visibleRow(user: AuthUser, id: string): Promise<LetterDetailRow> {
    const row = await this.repo.findDetailById(id);
    if (!row || row.deletedAt !== null) throw DomainException.notFound('Letter not found');
    const participants = row.confidential
      ? new Set((await this.repo.participants(id)).map((participant) => participant.userId))
      : undefined;
    if (!canViewLetter(user, row, participants)) {
      throw DomainException.notFound('Letter not found');
    }
    return row;
  }

  /** Фильтр реестров: конфиденциальные — только участникам и держателям
   *  права (#461, Р4). У держателя фильтра нет — видит всё. */
  private confidentialityWhere(user: AuthUser) {
    if (canViewConfidential(user)) return {};
    return {
      OR: [
        { confidential: false },
        { registrarId: user.id },
        { addresseeId: user.id },
        { participants: { some: { userId: user.id } } },
      ],
    };
  }

  /** Подстановка по адресу отправителя (Р6, В2): ровно один активный
   *  контакт — пара контрагент+подписант; 0 или ≥2 — подсказки нет. */
  private async counterpartySuggestionOf(
    fromAddress: string,
  ): Promise<{ counterpartyId: string; signerId: string } | null> {
    const found = await this.counterparties.findContactsByEmail(fromAddress);
    return found.length === 1
      ? { counterpartyId: found[0]!.counterpartyId, signerId: found[0]!.contactId }
      : null;
  }

  /** «Принимают решения» (#55): активные держатели `correspondence.resolve`. */
  async resolvers(): Promise<UserRef[]> {
    const holders = await this.membership.holdersOf(Permission.CORRESPONDENCE_RESOLVE);
    if (holders.length === 0) return [];
    const refs = await this.profiles.findRefs(holders.map((holder) => holder.id));
    return refs
      .filter((ref) => holders.some((holder) => holder.id === ref.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'))
      .slice(0, LETTER_LIMITS.resolvers);
  }

  private boxWhere(q: ListLettersQuery) {
    const alive = { deletedAt: null };
    const registered = { registeredAt: { not: null } };
    switch (q.box) {
      case 'new':
        return { ...alive, registeredAt: null };
      case 'incoming':
        return { ...alive, ...registered, direction: 'incoming' };
      case 'outgoing':
        return { ...alive, ...registered, direction: 'outgoing' };
      default:
        // Без box — только зарегистрированные обоих направлений (палитра,
        // CRM, вкладка «Письма» контрагента): «Новые» — отдельный box и
        // отдельное право, подмешивать их в общий поиск нельзя.
        return { ...alive, ...registered };
    }
  }

  private async searchWhere(search: string | undefined) {
    if (!search) return [];
    const counterpartyIds = await this.counterparties.searchIds(search, SEARCH_COUNTERPARTIES);
    return [
      {
        OR: [
          { subject: { contains: search, mode: 'insensitive' as const } },
          { regNumber: { contains: search, mode: 'insensitive' as const } },
          { theirNumber: { contains: search, mode: 'insensitive' as const } },
          // Поиск по номеру любого приложенного письма (#461, Р8): «456»
          // находит конверт, в котором лежит лист № 456.
          {
            attachedRefs: {
              some: { number: { contains: search, mode: 'insensitive' as const } },
            },
          },
          ...(counterpartyIds.length > 0 ? [{ counterpartyId: { in: counterpartyIds } }] : []),
        ],
      },
    ];
  }
}
