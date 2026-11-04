import type { LetterAccess } from '@nodus/contracts';
import { Permission } from '@nodus/contracts';

/**
 * Видимость писем (#55, Р7; #461, Р4) — одна чистая функция для карточки,
 * списков, дерева связей, моста чата и контрибьютора файлов. Невидимое
 * письмо отвечает 404 без оракула.
 *
 * Правило: зарегистрированное видят все вошедшие; незарегистрированное —
 * только держатели `correspondence.register` («Новые» — рабочее место
 * канцелярии). Незарегистрированное письмо не имеет номера, поэтому его
 * утечка — утечка входящего документа до учёта. Конфиденциальное (#461)
 * сужает круг до участников (регистратор, адресат, участники обсуждения) и
 * держателей `correspondence.view_confidential` — ни администратор, ни
 * замещение канцелярии не видят его без отдельной выдачи права.
 */

/** Держатель права регистрации (канцелярия/администратор). */
export function canRegisterLetters(user: { permissions: readonly string[] }): boolean {
  return user.permissions.includes(Permission.CORRESPONDENCE_REGISTER);
}

/** Держатель права «видеть конфиденциальные вне участников» (#461, В3). */
export function canViewConfidential(user: { permissions: readonly string[] }): boolean {
  return user.permissions.includes(Permission.CORRESPONDENCE_VIEW_CONFIDENTIAL);
}

/** Строка письма в объёме видимости. */
export interface LetterVisibilityRow {
  registeredAt: Date | null;
  confidential: boolean;
  registrarId: string | null;
  addresseeId: string | null;
}

const NOBODY: ReadonlySet<string> = new Set();

/** Видно ли письмо этому сотруднику; `participants` — состав обсуждения
 *  (читается вызывающим только для конфиденциальных — экономия запроса). */
export function canViewLetter(
  user: { id: string; permissions: readonly string[] },
  row: LetterVisibilityRow,
  participants: ReadonlySet<string> = NOBODY,
): boolean {
  if (row.registeredAt === null) return canRegisterLetters(user);
  if (!row.confidential) return true;
  if (canViewConfidential(user)) return true;
  return row.registrarId === user.id || row.addresseeId === user.id || participants.has(user.id);
}

/**
 * Права карточки (сервер — истина, I8): правка реквизитов и удаление спама —
 * канцелярия (правка незарегистрированного — заполнение полей по месту в
 * карточке, редизайн #56); «Присоединиться» — не участник: канцелярия может
 * «начать обсуждение» и до регистрации, остальные — только зарегистрированное.
 * У конфиденциального (#461) «Присоединиться» может только регистратор ЭТОГО
 * письма или держатель права: прочая канцелярия письма не видит (404).
 */
export function letterAccessOf(
  user: { id: string; permissions: readonly string[] },
  row: {
    registeredAt: Date | null;
    systemState: string;
    addresseeId: string | null;
    registrarId: string | null;
    confidential: boolean;
  },
  isParticipant: boolean,
): LetterAccess {
  const registrar = canRegisterLetters(user);
  const registered = row.registeredAt !== null;
  // Адресат — участник по построению (владелец беседы письма, Р10).
  const participant = isParticipant || row.addresseeId === user.id;
  const confidentialJoin =
    !row.confidential || row.registrarId === user.id || canViewConfidential(user);
  return {
    canEdit: registrar,
    canDeleteSpam: !registered && row.systemState !== 'closed' && registrar,
    canJoin: !participant && (registered || registrar) && confidentialJoin,
    isParticipant: participant,
  };
}

/** Связи правит только канцелярия (#461, Р1а, В2): «Добавить/Заменить/Снять». */
export function canManageRelations(user: { permissions: readonly string[] }): boolean {
  return canRegisterLetters(user);
}
