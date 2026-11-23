import { ui } from '@nodus/contracts';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@nodus/ui/components/empty';

/**
 * Правая зона карточки приглашённого (#101): вкладок «Чат/Задачи/Проекты»
 * нет — сотрудник ещё не активировал учётку; здесь только объяснение.
 * Действия администратора («Выпустить новую ссылку», «Отменить приглашение»)
 * живут в привычном «⋯» нижней полосы профиля (вердикт владельца 23.11.2026):
 * кнопки в центре пустой зоны дублировали меню и выглядели несистемно.
 */
export function InvitedCardPanel() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyTitle>{ui.employees.invitedCardTitle}</EmptyTitle>
          <EmptyDescription>{ui.employees.invitedCardText}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
