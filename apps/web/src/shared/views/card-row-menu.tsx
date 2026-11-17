import { Link2, SquareArrowOutUpRight } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { copyCardLink } from '../lib/card-link.js';
import type { RowMenuItem } from './row-menu.js';

/**
 * Базовая пара пунктов меню строки журнала — «Открыть» карточку и
 * «Копировать ссылку» deep-link ?cards=kind:id (аудит #45 — 4 дословные копии
 * в страницах).
 *
 * **Канон (вердикт владельца 25.10.2026): меню «шашки» — ПОЛНЫЙ набор команд
 * сущности**, доступных пользователю в списке. Модуль обязан добавить свои
 * действия следом (`separatorBefore: true` у первого), а не оставлять только
 * эту пару: «В архив»/«Из архива», «Удалить», доменные операции вроде
 * «Зарегистрировать» у писем. Опасные и необратимые — через подтверждение
 * (диалог у страницы, не внутри меню). Права: пункт, который сервер всё равно
 * отклонит, в меню не показываем (I8 — истина за сервером, но UI не дразнит).
 */
export function makeCardRowMenuItems<K extends string>(
  ref: { kind: K; id: string },
  openCard: (ref: { kind: K; id: string }) => void,
  /** Подпись пункта «открыть»: модуль уточняет действие (например, у
   *  сотрудника это «Открыть профиль»); по умолчанию — общее «Открыть». */
  options: { openLabel?: string } = {},
): RowMenuItem[] {
  return [
    {
      id: 'open',
      icon: <SquareArrowOutUpRight className="size-3.5" />,
      label: options.openLabel ?? ui.common.open,
      onSelect: () => openCard(ref),
    },
    {
      id: 'copy',
      icon: <Link2 className="size-3.5" />,
      label: ui.common.copyLink,
      onSelect: () => void copyCardLink(ref),
    },
  ];
}
