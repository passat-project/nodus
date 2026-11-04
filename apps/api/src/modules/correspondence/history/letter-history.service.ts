import { Inject, Injectable } from '@nestjs/common';
import {
  CORRESPONDENCE_EVENTS,
  type AuthUser,
  type LetterHistoryChange,
  type LetterHistoryEntry,
  type Paginated,
  type UserRef,
} from '@nodus/contracts';
import { z } from 'zod';

import { decodeCursor, encodeCursor } from '../../../core/pagination/cursor.util.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  COUNTERPARTY_READER,
  type CounterpartyReader,
} from '../../crm/ports/counterparty-reader.port.js';
import {
  DICTIONARY_READER,
  type DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';
import { canViewLetter } from '../access/letter-access.js';
import { LettersQueryService } from '../letters/letters-query.service.js';
import { LettersRepository } from '../letters/letters.repository.js';
import { LetterHistoryRepository } from './letter-history.repository.js';

const cursorSchema = z.object({ seq: z.string().regex(/^\d+$/) });

/** Сырое изменение из события `letter_updated` (значения — id/строки). */
interface RawChange {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * История карточки (#55, Р11): event log по агрегату `letter`. Подписи
 * ссылок гидрируются портами (корреспондент, подписант, способ поступления);
 * проект до #52 показывается пустым — модуля ещё нет.
 */
@Injectable()
export class LetterHistoryService {
  constructor(
    private readonly repo: LetterHistoryRepository,
    private readonly letters: LettersRepository,
    private readonly query: LettersQueryService,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    @Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader,
    @Inject(DICTIONARY_READER) private readonly dictionaries: DictionaryReader,
  ) {}

  async list(
    user: AuthUser,
    letterId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Paginated<LetterHistoryEntry>> {
    await this.query.visibleRow(user, letterId);
    const before = cursor ? BigInt(decodeCursor(cursor, cursorSchema).seq) : undefined;
    const rows = await this.repo.page(letterId, before, limit);
    const page = rows.slice(0, limit);
    const actorIds = page.map((row) => row.actorId).filter((id): id is string => id !== null);
    const actors = new Map(
      (await this.profiles.findRefs([...new Set(actorIds)])).map((ref) => [ref.id, ref]),
    );
    const items = (
      await Promise.all(
        page.map((row) =>
          this.toEntry(
            user,
            row.id,
            row.type,
            row.actorId ? (actors.get(row.actorId) ?? null) : null,
            row.createdAt,
            row.payload as Record<string, unknown>,
          ),
        ),
      )
    ).filter((entry): entry is LetterHistoryEntry => entry !== null);
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor({ seq: last.seq.toString() }) : null,
    };
  }

  private async toEntry(
    user: AuthUser,
    id: string,
    type: string,
    actor: UserRef | null,
    at: Date,
    payload: Record<string, unknown>,
  ): Promise<LetterHistoryEntry | null> {
    const base = { id, at: at.toISOString(), actor };
    switch (type) {
      case CORRESPONDENCE_EVENTS.LETTER_RECEIVED:
        return { ...base, kind: 'received', source: payload.source as 'manual' | 'mail' };
      case CORRESPONDENCE_EVENTS.LETTER_REGISTERED:
        return { ...base, kind: 'registered', regNumber: String(payload.regNumber ?? '') };
      case CORRESPONDENCE_EVENTS.LETTER_UPDATED:
        return {
          ...base,
          kind: 'updated',
          changes: await this.hydrate((payload.changes as RawChange[] | undefined) ?? []),
        };
      case CORRESPONDENCE_EVENTS.LETTER_STAGE_CHANGED:
        return {
          ...base,
          kind: 'stage_changed',
          transitionName: String(payload.transitionName ?? 'Смена статуса'),
          fromStageName: String(payload.fromStageName ?? '—'),
          toStageName: String(payload.toStageName ?? '—'),
          ...(payload.comment ? { comment: String(payload.comment) } : {}),
        };
      case CORRESPONDENCE_EVENTS.LETTER_RELATIONS_CHANGED: {
        // Связь поставлена/заменена/снята (#461, Р6): вторая сторона —
        // ссылкой (номер и тема гидратируются, как у превью).
        const relatedLetterId = String(payload.relatedLetterId ?? '');
        // Цель связи-конфиденциальное вне участия не раскрывается (#461, Р4):
        // запись истории молча пропускается — номер и тема цели не оракулят.
        const target = (await this.letters.visibilityRows([relatedLetterId]))[0];
        if (!target || target.deletedAt !== null) return null;
        const members = target.confidential
          ? new Set(
              (await this.letters.participants(relatedLetterId)).map(
                (participant) => participant.userId,
              ),
            )
          : undefined;
        if (!canViewLetter(user, target, members)) return null;
        const related = (await this.letters.refs([relatedLetterId]))[0];
        return {
          ...base,
          kind: 'relation_changed',
          action: payload.action as 'linked' | 'unlinked' | 'replaced',
          relationKind: payload.kind as 'reply_to' | 'nested_in',
          relatedLetter: related ?? { id: relatedLetterId, regNumber: null, subject: null },
        };
      }
      case CORRESPONDENCE_EVENTS.LETTER_PARTICIPANTS_CHANGED: {
        // В историю идёт только личное присоединение (актор = добавленный);
        // синхронизация состава при регистрации — не событие карточки.
        const added = (payload.added as string[] | undefined) ?? [];
        return added.length === 1 && added[0] === actor?.id
          ? { ...base, kind: 'participant_joined' }
          : null;
      }
      default:
        return null;
    }
  }

  /** Значения — строки показа: ссылки → имена, даты — ISO, атрибуты — текст. */
  private async hydrate(changes: readonly RawChange[]): Promise<LetterHistoryChange[]> {
    const counterpartyIds = idsOf(changes, 'counterpartyId');
    const signerIds = idsOf(changes, 'signerId');
    const receiptIds = idsOf(changes, 'receiptMethodId');
    const addresseeIds = idsOf(changes, 'addresseeId');
    const [counterparties, contacts, receipts, users] = await Promise.all([
      this.counterparties.refs(counterpartyIds),
      this.counterparties.contactRefs(signerIds),
      this.dictionaries.itemRefs(receiptIds),
      this.profiles.findRefs(addresseeIds),
    ]);
    const names = new Map<string, string>([
      ...counterparties.map((ref) => [ref.id, ref.name] as const),
      ...contacts.map((ref) => [ref.id, ref.fullName] as const),
      ...receipts.map((ref) => [ref.id, ref.name] as const),
      ...users.map((ref) => [ref.id, ref.displayName] as const),
    ]);
    return changes.map((change) => ({
      field: change.field,
      from: display(change.field, change.from, names),
      to: display(change.field, change.to, names),
    }));
  }
}

function idsOf(changes: readonly RawChange[], field: string): string[] {
  const ids = new Set<string>();
  for (const change of changes) {
    if (change.field !== field) continue;
    // Пустая строка — «пусто» (валидатор патча пишет `row.x ?? ''` в
    // незарегистрированном письме): в refs она не идёт — Prisma падает на
    // uuid '' (приёмка 28.10, история 500), показ — «пусто» в display.
    if (typeof change.from === 'string' && change.from !== '') ids.add(change.from);
    if (typeof change.to === 'string' && change.to !== '') ids.add(change.to);
  }
  return [...ids];
}

/** Строка показа значения: ссылка — имя из справочника, проект — пусто (#52). */
function display(field: string, value: unknown, names: Map<string, string>): string | null {
  if (value === null || value === undefined) return null;
  if (field === 'projectId') return null;
  if (typeof value === 'string') return names.get(value) ?? value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  return JSON.stringify(value);
}
