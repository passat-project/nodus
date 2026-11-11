import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@nodus/ui/lib/utils';

import { PersonAvatar } from '../ui/person-avatar.js';
import { useChatPrefs } from './chat-prefs.js';
import type { MessageRun } from './message-groups.js';

/**
 * Серия сообщений одного автора — grid «колонка аватара + пузыри» (#164,
 * вердикт владельца 30.09, референсы Telegram/Битрикс24). Аватар вынесен ИЗ
 * строки последнего сообщения в отдельный элемент серии: колонка 1,
 * `grid-row: 1 / N+1`, `align-self: end`, `position: sticky; bottom: 8px`.
 * Пока серия уходит за нижний сгиб вьюпорта, аватар прижат к нижней кромке
 * ленты (над композером); у конца серии встаёт на обычное место у последнего
 * пузыря. Один высокий пузырь работает тем же механизмом (его строка — вся
 * серия). Чистый CSS без JS-замеров (антипример coder/coder#27673: ручной
 * расчёт sticky давал 902 forced layout на 151 сообщение; нативный sticky
 * внутри секции-контейнера бесплатен).
 *
 * Канон серий не менялся (message-groups.ts): имя автора — чужое и только
 * у первого пузыря, хвостик — у последнего; аватар — у КАЖДОЙ серии (свои и
 * чужие — так было у последнего пузыря и до #164; баг-урок приёмки 30.09:
 * «моя аватарка пропала» — свои серии без аватара не канон). В режиме
 * «По обе стороны» своя серия зеркалится: аватар — в колонке СПРАВА (как
 * раньше row-reverse у Message).
 *
 * Виртуализация (задел после пилота): механизм локален для контейнера серии
 * и совместим только с оконной виртуализацией НА РАспорках (in-flow окно +
 * spacer'ы, стиль react-virtuoso). Виртуализатор с абсолютным позиционированием
 * строк (react-window) вынимает строки из grid-потока — sticky с ним невозможен.
 * При нарезке окна серия передаётся СРЕЗКОЙ (items = смонтированные строки),
 * first/last — от полной серии (дистрибуция имени/хвостика не собьётся).
 */

/** Атрибуты строки серии, вычисленные компонентой (дистрибуция канона). */
export interface MessageRunItemAttrs {
  /** Имя автора внутри первого пузыря — чужие серии (в групповых чатах). */
  showName: boolean;
  /** Хвостик из низа аватарки — последний пузырь серии. */
  tail: boolean;
  /** Grid-позиция строки: растянуть на обёртке хоста (MessageScrollerItem). */
  style: CSSProperties;
}

export function MessageRunView({
  run,
  showName,
  spacing = 'chat',
  dividerBeforeId = null,
  divider,
  renderItem,
}: {
  run: MessageRun;
  /** Показывать имя автора в первом пузыре (чужие серии в групповых чатах). */
  showName: boolean;
  /** Вертикальный ритм серии: 'chat' — пузыри слипаются в блок (2px, канон
   *  чатов); 'feed' — посты канала 6px (вердикт 01.10 #175: 2px между
   *  карточками «слипшиеся», межавторские 12px сохраняются — разница есть,
   *  как в Битриксе, но мягче). */
  spacing?: 'chat' | 'feed';
  /** Разделитель непрочитанных ставится ПЕРЕД этим сообщением серии. */
  dividerBeforeId?: string | null;
  /** Содержимое разделителя; обёртка хоста (MessageScrollerItem) внутри. */
  divider?: ReactNode;
  /** Строка сообщения: обёртки хоста (скроллер/меню/выбор) + ChatMessageItem
   *  с attrs; аватар и колонку серии рисует эта компонента (avatarSlot="none"). */
  renderItem: (message: MessageRun['items'][number], attrs: MessageRunItemAttrs) => ReactNode;
}) {
  // Разделитель считается строкой только когда он ДЕЙСТВИТЕЛЬНО внутри этой
  // серии (firstUnreadId — глобальный по ленте): лишняя строка сдвинула бы
  // точку освобождения sticky-аватара на высоту строки.
  const hasDivider = dividerBeforeId !== null && run.items.some((m) => m.id === dividerBeforeId);
  const rowCount = run.items.length + (hasDivider ? 1 : 0);
  // «По обе стороны»: своя серия зеркалится — аватар справа (баг-урок 30.09:
  // свои серии несут аватар так же, как чужие). Хук — ДО условия (Rules of
  // Hooks: закорачивание && пропускал вызов у mine-серий — P1 валидатора).
  const align = useChatPrefs((s) => s.align);
  const atEnd = run.mine && align === 'both';
  let row = 0;
  return (
    <div
      data-slot="message-run"
      className={cn(
        'grid min-w-0 gap-x-2',
        spacing === 'feed' ? 'gap-y-1.5' : 'gap-y-0.5',
        atEnd ? 'grid-cols-[minmax(0,1fr)_2rem]' : 'grid-cols-[2rem_minmax(0,1fr)]',
      )}
    >
      <div
        data-slot="message-run-avatar"
        className="sticky bottom-2 self-end"
        style={{ gridColumn: atEnd ? 2 : 1, gridRow: `1 / ${rowCount + 1}` }}
      >
        <PersonAvatar
          name={run.last.author.displayName}
          avatarUrl={run.last.author.avatarUrl}
          decorative
          className="size-7"
        />
      </div>
      {run.items.map((message) => {
        const dividerHere = message.id === dividerBeforeId;
        const cells: ReactNode[] = [];
        if (dividerHere) {
          row += 1;
          cells.push(
            <div
              key={`unread-divider-${message.id}`}
              style={{ gridColumn: '1 / -1', gridRow: row }}
            >
              {divider}
            </div>,
          );
        }
        row += 1;
        cells.push(
          <Fragment key={message.id}>
            {renderItem(message, {
              showName: showName && message.id === run.first.id,
              tail: message.id === run.last.id,
              style: { gridColumn: atEnd ? 1 : 2, gridRow: row },
            })}
          </Fragment>,
        );
        return cells;
      })}
    </div>
  );
}
