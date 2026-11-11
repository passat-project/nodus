import type { ReactNode } from 'react';
import type { UserRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { PersonAvatar } from './person-avatar.js';

/** Моно-стиль текстовых ячеек таблиц (даты, номера): единая константа
 *  (аудит #45 — 4 копии в реестрах полей). */
export const monoCell = 'font-mono text-label-sm text-muted-foreground tabular-nums';

/** Ячейка «человек» таблиц/реестров: аватар + имя либо «Не задано»
 *  (аудит #45 — 5 дословных копий personCell в реестрах полей). Фото берётся
 *  из `UserRef.avatarUrl` (#726): ячейка не должна оставаться на инициалах,
 *  когда фото есть. */
export function PersonCell({ user }: { user: UserRef | string | null | undefined }): ReactNode {
  const name = typeof user === 'string' ? user : user?.displayName;
  if (!name) return <span className="text-xs text-muted-foreground">{ui.common.notSet}</span>;
  return (
    <>
      <PersonAvatar
        name={name}
        avatarUrl={typeof user === 'string' ? null : user?.avatarUrl}
        decorative
        className="size-6 shrink-0"
      />
      <span className="truncate">{name}</span>
    </>
  );
}
