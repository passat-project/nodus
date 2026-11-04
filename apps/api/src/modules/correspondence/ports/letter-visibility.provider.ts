import { Injectable } from '@nestjs/common';

import { canViewLetter } from '../access/letter-access.js';
import { LettersRepository } from '../letters/letters.repository.js';
import type { LetterVisibilityReader, LetterVisibilityViewer } from './letter-visibility.port.js';

/**
 * Реализация порта видимости писем (#461, Р4): та же функция `canViewLetter`,
 * что у карточки и реестра, — счётчик CRM не расходится со вкладкой
 * «Письма». Конфиденциальные строки проверяются по составу обсуждения
 * (один батч-запрос участников).
 */
@Injectable()
export class LetterVisibilityProvider implements LetterVisibilityReader {
  constructor(private readonly letters: LettersRepository) {}

  async visibleLetterIds(
    letterIds: readonly string[],
    viewer: LetterVisibilityViewer,
  ): Promise<ReadonlySet<string>> {
    const rows = await this.letters.visibilityRows(letterIds);
    const confidentialIds = rows.filter((row) => row.confidential).map((row) => row.id);
    const participants = await this.letters.participantsOf(confidentialIds);
    const visible = new Set<string>();
    for (const row of rows) {
      // Надгробия не считаются: число совпадает со списком (Р13, #461).
      if (row.deletedAt !== null) continue;
      const members = new Set(
        participants
          .filter((participant) => participant.letterId === row.id)
          .map((participant) => participant.userId),
      );
      if (canViewLetter(viewer, row, members)) visible.add(row.id);
    }
    return visible;
  }
}
