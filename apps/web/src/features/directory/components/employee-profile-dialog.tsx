import { useRef, useState } from 'react';
import type { UserCard, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';

import { useAuthStore } from '../../../shared/auth-store.js';
import { useUpdateMyProfile, useUpdateUser } from '../api/directory-api.js';
import { buildProfilePatches, draftOf, type ProfileDraft } from '../lib/profile-draft.js';
import { ProfileDialogSections } from './employee-profile-dialog-fields.js';

/**
 * Единое окно редактирования профиля (#923): секции «Личные данные /
 * Контакты / Работа / Структура». Сотрудник на своей карточке правит ФИО и
 * личные/контактные поля, структура и HR-данные — только для чтения (синим);
 * администратор правит всё, кроме email-логина и руководителя (производное
 * поле структуры). Сохраняются ТОЛЬКО изменённые поля, оптимистично; своя
 * карточка идёт через `PATCH /directory/users/me`, структура/HR — карточкой.
 */
export function EmployeeProfileDialog({
  open,
  onOpenChange,
  card,
  users,
  canManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: UserCard;
  users: UserListItem[];
  canManage: boolean;
}) {
  const meId = useAuthStore((state) => state.user?.id);
  const isSelf = card.id === meId;
  const updateSelf = useUpdateMyProfile();
  const updateUser = useUpdateUser(card.id);
  const [draft, setDraft] = useState<ProfileDraft>(() => draftOf(card));
  // Фокус окна — в «Фамилию» В КОНЕЦ без выделения (вердикт приёмки
  // 18.11.2026): Radix FocusScope фокусирует первый input и зовёт `select()`,
  // первое нажатие клавиши стирало фамилию. Паттерн — окно подразделения.
  const lastNameRef = useRef<HTMLInputElement>(null);
  const autoSelectGuard = useRef(false);

  // Черновик наполняется на каждом открытии (рендер-тайм, канон #45).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setDraft(draftOf(card));
  }

  const pending = updateSelf.isPending || updateUser.isPending;
  const namesMissing = draft.lastName.trim().length === 0 || draft.firstName.trim().length === 0;

  function submit() {
    if (pending || namesMissing) return;
    const { selfPatch, adminPatch } = buildProfilePatches(card, draft, {
      self: isSelf,
      manage: canManage,
    });
    if (isSelf) {
      if (Object.keys(selfPatch).length > 0) updateSelf.mutate(selfPatch);
      if (Object.keys(adminPatch).length > 0) updateUser.mutate(adminPatch);
    } else if (Object.keys(adminPatch).length > 0) {
      updateUser.mutate(adminPatch);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-full bg-card sm:max-w-2xl"
        // Форма с несохранёнными значениями: мимо-клик не должен её терять.
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          autoSelectGuard.current = true;
          // Каретку ставим следующим кадром: FocusScope возвращает фокус в поле
          // с `select()` уже после обработчика (закрытие меню «⋯»).
          requestAnimationFrame(() => {
            const input = lastNameRef.current;
            if (!input || !input.isConnected) return;
            input.focus();
            const end = input.value.length;
            input.setSelectionRange(end, end);
          });
        }}
      >
        <DialogTitle className="text-lg leading-tight font-semibold text-foreground">
          {isSelf ? ui.employees.editProfile : ui.employees.editEmployeeTitle}
        </DialogTitle>
        {/* Секции — в своей прокрутке: окно не растёт выше экрана на узких
            ноутбуках, кнопки футера всегда видны. */}
        <div className="@container max-h-[70vh] overflow-y-auto pr-1">
          <ProfileDialogSections
            card={card}
            draft={draft}
            users={users}
            canManage={canManage}
            lastNameRef={lastNameRef}
            autoSelectGuard={autoSelectGuard}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {ui.common.cancel}
          </Button>
          <Button disabled={pending || namesMissing} onClick={submit}>
            {ui.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
