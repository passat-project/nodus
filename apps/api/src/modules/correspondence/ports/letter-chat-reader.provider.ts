import { Injectable } from '@nestjs/common';
import type { LetterRef } from '@nodus/contracts';

import { canViewLetter } from '../access/letter-access.js';
import { LettersRepository } from '../letters/letters.repository.js';
import type {
  LetterChatReader,
  LetterChatRoster,
  LetterViewer,
} from './letter-chat-reader.port.js';

/**
 * Реализация порта письма для чата (#55, Р10): состав беседы (адресат —
 * владелец, участники — члены), ссылки для превью и видимость той же
 * функцией, что у карточки (Р7). Незарегистрированное письмо получает
 * беседу с первым участником-владельцем, когда обсуждение начато
 * (редизайн #56); состав переживает регистрацию — sync после неё делает
 * владельцем адресата, прежний владелец остаётся участником (осознанно).
 */
@Injectable()
export class LetterChatReaderProvider implements LetterChatReader {
  constructor(private readonly letters: LettersRepository) {}

  async roster(letterId: string): Promise<LetterChatRoster | null> {
    const row = await this.letters.chatRoster(letterId);
    if (!row || row.deletedAt !== null) return null;
    if (row.registeredAt !== null) {
      // Зарегистрированное: владелец — адресат (без адресата беседы нет).
      if (!row.addresseeId) return null;
      return {
        ownerId: row.addresseeId,
        members: (await this.letters.participants(letterId)).map((participant) => ({
          userId: participant.userId,
          muted: false,
        })),
      };
    }
    // Незарегистрированное: обсуждение существует, только если канцелярия
    // его начала (есть участники); создатель — первый по времени участник.
    const participants = await this.letters.participants(letterId);
    if (participants.length === 0) return null;
    return {
      ownerId: participants[0]!.userId,
      members: participants.map((participant) => ({
        userId: participant.userId,
        muted: false,
      })),
    };
  }

  refs(ids: readonly string[]): Promise<LetterRef[]> {
    return this.letters.refs(ids) as Promise<LetterRef[]>;
  }

  async canView(letterId: string, viewer: LetterViewer): Promise<boolean> {
    const row = await this.letters.findDetailById(letterId);
    // Надгробие спама невидимо никому — карточка уже 404 (Р13, #461).
    if (!row || row.deletedAt !== null) return false;
    // Конфиденциальное (#461): участник обсуждения видит чат так же, как
    // карточку, — состав читается ДО проверки (техплан Р4).
    const participants = row.confidential
      ? new Set((await this.letters.participants(letterId)).map((item) => item.userId))
      : undefined;
    return canViewLetter(viewer, row, participants);
  }
}
