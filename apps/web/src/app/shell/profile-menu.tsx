import { LogOut, UserRound } from 'lucide-react';
import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';

import { useAuthStore } from '../../shared/auth-store.js';
import { PersonAvatarById } from '../../shared/ui/person-avatar.js';
import { LATEST_RELEASE } from '../../features/whats-new/model/releases.js';
import { isUnseen, useWhatsNewStore } from '../../features/whats-new/model/whats-new-store.js';
import { useOpenCard } from './use-card-stack.js';

/**
 * Аватарка профиля с меню — ПРАВЫЙ ВЕРХ мягкой рамы, в топбаре СПРАВА от
 * уведомлений (вердикт владельца 15.09.2026: профиль ушёл из служебной полосы,
 * полоса — только аватарки сотрудников). Тот же кегль, что аватарки коллег
 * (size-7), тонкий цветной ободок ring-1 primary/60 отличает свой профиль
 * (вердикт 14.09.2026: ободок, не плашка). Меню — имя, «Профиль» (#751: своя
 * карточка сотрудника тем же стеком, что из проекта/справочника), «Что
 * нового» и выход, вниз-вправо от аватарки (порталы оверлеев z-[70],
 * лестница z).
 *
 * ПРАВИЛО (#738, вердикт владельца 10.11): меню профиля — только действия
 * профиля. Настройки портала живут в левом меню «Настройки» (канон места —
 * #276) и в профиль не возвращаются: пункт «Настройки портала» здесь давал
 * второй, неочевидный вход и дублировал настройку портала.
 *
 * «Что нового» (#1038, модель владельца 25.11): истории обновлений здесь
 * место вместо кнопки топбара (обе поверхности); пункт ТЕКСТОВЫЙ, без
 * иконки — звёздочки/спарклы закреплены за ИИ-ассистентом; точка у
 * правого края — последний выпуск ещё не просмотрен этим пользователем.
 */
export function ProfileMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const openCard = useOpenCard();
  // Локальная константа: narrowing импорта не живёт в замыкании onClick.
  const latestWhatsNew = LATEST_RELEASE;
  const unseenWhatsNew = useWhatsNewStore((s) =>
    isUnseen(s.seen, user?.id, latestWhatsNew?.version),
  );
  const showWhatsNew = useWhatsNewStore((s) => s.show);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ui.topbar.profile}
          className="shrink-0 rounded-md p-0.5 hover:bg-accent"
        >
          <PersonAvatarById
            userId={user?.id}
            name={user?.displayName ?? ''}
            decorative
            className="size-7 shrink-0 ring-1 ring-primary/60"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{user?.displayName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {user ? (
            <DropdownMenuItem onClick={() => openCard({ kind: 'employee', id: user.id })}>
              <UserRound data-icon="inline-start" />
              {ui.topbar.profile}
            </DropdownMenuItem>
          ) : null}
          {latestWhatsNew ? (
            <DropdownMenuItem
              onClick={() => showWhatsNew(user?.id, latestWhatsNew.version, 'manual')}
            >
              {ui.whatsNew.title}
              {unseenWhatsNew && (
                <span
                  data-testid="whats-new-unseen"
                  aria-hidden="true"
                  className="ml-auto size-2 shrink-0 rounded-full bg-info"
                />
              )}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => void logout()}>
            <LogOut data-icon="inline-start" />
            {ui.topbar.logout}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
