import type { UserRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { openCardViaBridge } from '../lib/card-bridge.js';
import { PersonAvatar } from '../ui/person-avatar.js';

/**
 * Аватар автора сообщения (#728): у ЧУЖОГО сообщения — настоящая кнопка
 * «Открыть карточку сотрудника». Карточка идёт стеком поверх мессенджера
 * (ADR-0009), rect источника — сам аватар: карточка раскрывается из него
 * (shared-element) и при закрытии возвращает в чат на то же место (лента живёт
 * под карточкой, скролл/фокус не пересоздаются). Подсказка (`title`) — имя
 * человека: наведение на аватар должно называть автора, а не действие.
 *
 * Своё сообщение — пассивная аватарка: свой профиль открывается из топбара,
 * карточка самого себя в ленте — лишний шаг (рекомендация issue #728).
 *
 * Механика кликов вокруг НЕ меняется: аватар не глотает события (ПКМ-меню —
 * на строке, реакции — на пузыре, лайтбокс — на картинках). Известное
 * ограничение: в ленте беседы аватар рисует `MessageRunView` ОТДЕЛЬНОЙ
 * ячейкой вне `MessageRow`, поэтому в режиме выделения клик по аватару
 * открывает карточку поверх выделения (capture-гейт строки его не видит).
 * Так же ведут себя корень треда и пост канала — аватар ВНУТРИ `MessageRow`
 * там глотается гейтом. Поведение оставлено как есть: решение — за владельцем
 * (отдельный issue). Для клавиатуры и тача всё штатно: нативный `<button>`
 * (Enter/Space, тап, focus-visible по канону кнопок).
 */
export function MessageAuthorAvatar({
  author,
  mine,
  className,
  avatarClassName = 'size-7',
}: {
  /** Автор сообщения из DTO (`userRef`: id + имя + фото). */
  author: UserRef;
  /** Своё сообщение/своя серия — карточку не открываем. */
  mine: boolean;
  /** Классы обёртки (кнопки или нейтрального span у своего сообщения). */
  className?: string;
  /** Размер аватара: лента — size-7, блок перехода задачи — size-8. */
  avatarClassName?: string;
}) {
  const avatar = (
    <PersonAvatar
      name={author.displayName}
      avatarUrl={author.avatarUrl}
      decorative
      className={avatarClassName}
      // Подсказку несёт кнопка-аватар («Имя Фамилия») — второй title не нужен.
      title=""
    />
  );
  // Своё — пассивная аватарка в той же обёртке: классы раскладки хоста
  // (например, mt-auto блока перехода) сохраняются и без кнопки.
  if (mine) return <span className={cn('block w-fit shrink-0', className)}>{avatar}</span>;
  return (
    <button
      type="button"
      data-slot="message-author-avatar"
      // Скринридер: имя человека + действие (строка действия — из i18n).
      aria-label={`${author.displayName}, ${ui.chat.openEmployeeCard}`}
      // Подсказка при наведении — имя и фамилия, не название действия.
      title={author.displayName}
      onClick={(event) => {
        event.stopPropagation();
        openCardViaBridge(
          { kind: 'employee', id: author.id },
          event.currentTarget.getBoundingClientRect(),
        );
      }}
      className={cn(
        // w-fit: кнопка обнимает круг аватара — фокус-рамка идёт по
        // окружности, а не по прямоугольнику колонки серии.
        'block w-fit shrink-0 cursor-pointer rounded-full outline-none',
        // Канон фокуса кнопок (`packages/ui/.../button.tsx`): тонкая рамка,
        // толстые ринги запрещены (nodus-ui-style/references/tokens.md).
        'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40',
        // Ховер — тот же приём, что у чипа упоминания (аватар — графит).
        'transition-[filter] hover:brightness-110',
        className,
      )}
    >
      {avatar}
    </button>
  );
}
