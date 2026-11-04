import { Inject, Injectable } from '@nestjs/common';

import type {
  FileAccessContributor,
  FileAccessDecision,
} from '../../../core/ports/file-access.port.js';
import {
  ROLE_MEMBERSHIP_READER,
  type RoleMembershipReader,
} from '../../../core/ports/role-membership.port.js';
import { canViewLetter } from '../access/letter-access.js';
import { LettersRepository } from '../letters/letters.repository.js';

/**
 * Контрибьютор прав файлов писем (#55, B5/F1): файл виден, если видимо
 * письмо, в котором он лежит (та же функция видимости, Р7 — незарегистрированное
 * видят только держатели `correspondence.register`). Правка запрещена
 * всегда: входящий документ неизменяем (`canEdit:false`, #466 подпись —
 * через исходящие #464).
 */
@Injectable()
export class LetterFileAccess implements FileAccessContributor {
  /** Маркер контекста для реестра прав файлов. */
  static readonly fileAccessContext = 'letter';
  readonly fileAccessContext = LetterFileAccess.fileAccessContext;

  constructor(
    private readonly letters: LettersRepository,
    @Inject(ROLE_MEMBERSHIP_READER) private readonly membership: RoleMembershipReader,
  ) {}

  async check(fileId: string, userId: string): Promise<FileAccessDecision | null> {
    const letters = await this.letters.visibilityByFile(fileId);
    if (letters.length === 0) return null;
    const permissions = await this.membership.effectivePermissions(userId);
    // Надгробие (удалённое спам-письмо, Р13) не видно никому: строки БД
    // остаются, пока хранилище чистится best-effort, — файл закрыт и для
    // загрузившего.
    const alive = letters.filter((letter) => letter.deletedAt === null);
    if (alive.length === 0) return { canView: false, canEdit: false, deny: true };
    const visible = alive.some((letter) =>
      canViewLetter({ id: userId, permissions }, letter, new Set(letter.participants)),
    );
    // deny — вето поверх владения файлом (#461): загрузивший скан не читает
    // файл письма, которое ему больше не видно (конфиденциальность, чужой
    // круг участников), — иначе `ownerId` в движке просмотра обходил бы
    // видимость. immutable — тот же капкан для ПРАВКИ (security-ревью #55).
    if (!visible) return { canView: false, canEdit: false, deny: true };
    return { canView: true, canEdit: false, immutable: true };
  }
}
