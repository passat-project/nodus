import {
  BadgeCheck,
  CheckSquare,
  Copy,
  Forward,
  Link2,
  ListTodo,
  Pencil,
  Pin,
  Quote,
  Reply,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

/**
 * Чистые билдеры пунктов контекстного меню сообщения (message-menu.tsx):
 * состав, порядок, подписи, дизейблы и фильтры по правам/варианту. Побочные
 * эффекты пунктов — колбэки хоста (MessageMenuActions): билдер не знает про
 * сторы, мутации и фокус.
 */

export interface MenuItem {
  id: string;
  icon: typeof Reply;
  label: string;
  danger?: boolean;
  separatorBefore?: boolean;
  /** #243: серверная команда недоступна на летящем темпе (seq=0,
   *  id=tempId) — сервер не знает tempId; дизейбл до подтверждения
   *  (канон Telegram: с неотправленным ничего делать нельзя). */
  disabled?: boolean;
  /** #132 р.2: действие, переключающее режим селекта («Отменить выбор»/
   *  «Выбрать»), выполняется ПОСЛЕ закрытия меню — иначе контент меню
   *  морфится в противоположный набор прямо в анимации закрытия («старое
   *  меню пропало, отрендерилось новое полное»). */
  closeFirst?: boolean;
  run: () => void;
}

/** #237: набор Telegram для окна-источника «Избранного». */
const SOURCE_WINDOW_ITEMS = new Set(['copy', 'forward', 'select', 'delete']);

export interface SelectionMenuInput {
  hideFavorite: boolean;
  /** В выделении есть летящие (#243): серверные команды серые. */
  selectionPending: boolean;
  onFavoriteSelected: () => void;
  onForwardSelected: () => void;
  onDeleteSelected: () => void;
  onCopySelected: () => void;
  onClearSelection: () => void;
}

/** Меню режима мультивыбора (A6, канон tdesktop). */
export function buildSelectionItems(input: SelectionMenuInput): MenuItem[] {
  const { selectionPending } = input;
  return [
    // Витрина «Избранного» (hideFavorite): звезда на свои записи —
    // self-reference, дизайн запрещает и в режиме селекта.
    ...(input.hideFavorite
      ? []
      : [
          {
            id: 'favoriteSelected',
            icon: Star,
            label: ui.chat.favoriteSelected,
            disabled: selectionPending,
            run: input.onFavoriteSelected,
          },
        ]),
    {
      id: 'forwardSelected',
      icon: Forward,
      label: ui.chat.forwardSelected,
      disabled: selectionPending,
      run: input.onForwardSelected,
    },
    {
      id: 'deleteSelected',
      icon: Trash2,
      label: ui.chat.deleteSelected,
      danger: true,
      disabled: selectionPending,
      run: input.onDeleteSelected,
    },
    {
      id: 'copySelected',
      icon: Copy,
      label: ui.chat.copySelected,
      run: input.onCopySelected,
    },
    {
      // #132: единственная команда выхода (модель Telegram «Отменить
      // выбор»); дубль «Снять отметку» удалён — при одном выбранном они
      // делали одно и то же (снятие последнего выходит из режима).
      id: 'clearSelection',
      icon: X,
      label: ui.chat.clearSelection,
      separatorBefore: true,
      closeFirst: true,
      run: input.onClearSelection,
    },
  ];
}

/** Побочные эффекты пунктов меню одного сообщения (реализует хост). */
export interface MessageMenuActions {
  reply: () => void;
  quoteFragment: () => void;
  copy: () => void;
  edit: () => void;
  forward: () => void;
  toTask: () => void;
  markResult: (taskId: string) => void;
  pin: () => void;
  copyLink: () => void;
  favorite: () => void;
  select: () => void;
  delete: () => void;
}

export interface MessageMenuInput {
  message: ChatMessage;
  mine: boolean;
  /** Несвёрнутое выделение текста внутри сообщения («Цитировать фрагмент»). */
  fragment: string | null;
  isFavorite: boolean;
  canModerate: boolean;
  hideFavorite: boolean;
  variant?: 'source-window';
  /** Чат задачи (#252): id задачи беседы — пункт «Отметить как результат». */
  taskId: string | undefined;
  actions: MessageMenuActions;
}

/** Меню одного сообщения: пункты + флаг подменю «Кто просмотрел». */
export function buildMessageItems(input: MessageMenuInput): {
  items: MenuItem[];
  showViewers: boolean;
} {
  const { message, mine, fragment, isFavorite, canModerate, hideFavorite, variant, taskId } = input;
  const actions = input.actions;
  // Летящий темп (seq=0, id=tempId): серверных команд нет — сервер не
  // знает tempId (#243; канон Telegram: с неотправленным ничего делать
  // нельзя). Локальные (копировать, выделить) — доступны.
  const pending = message.seq === 0;
  const items: MenuItem[] = [
    {
      id: 'reply',
      icon: Reply,
      label: ui.chat.menu.reply,
      disabled: pending,
      run: actions.reply,
    },
  ];
  if (fragment) {
    items.push({
      id: 'quoteFragment',
      icon: Quote,
      label: ui.chat.quoteFragment,
      disabled: pending,
      run: actions.quoteFragment,
    });
  }
  items.push(
    {
      id: 'copy',
      icon: Copy,
      label: ui.chat.menu.copy,
      run: actions.copy,
    },
    {
      id: 'edit',
      icon: Pencil,
      label: ui.chat.menu.edit,
      disabled: pending,
      run: actions.edit,
    },
    {
      id: 'forward',
      icon: Forward,
      label: ui.chat.menu.forward,
      disabled: pending,
      run: actions.forward,
    },
    {
      id: 'toTask',
      icon: ListTodo,
      label: ui.chat.menu.createTask,
      disabled: pending,
      run: actions.toTask,
    },
  );
  // Чат задачи (#252): сообщение можно сделать результатом задачи.
  if (taskId) {
    items.push({
      id: 'markResult',
      icon: BadgeCheck,
      label: ui.chat.menu.markResult,
      disabled: pending,
      run: () => actions.markResult(taskId),
    });
  }
  items.push(
    {
      id: 'pin',
      icon: Pin,
      label: message.pinned ? ui.chat.unpin : ui.chat.menu.pin,
      disabled: pending,
      run: actions.pin,
    },
    {
      id: 'copyLink',
      icon: Link2,
      label: ui.chat.menu.copyLink,
      disabled: pending,
      run: actions.copyLink,
    },
    {
      id: 'favorite',
      icon: Star,
      label: isFavorite ? ui.chat.unfavorite : ui.chat.menu.favorite,
      disabled: pending,
      run: actions.favorite,
    },
    {
      id: 'select',
      icon: CheckSquare,
      label: ui.chat.menu.select,
      closeFirst: true,
      run: actions.select,
    },
    {
      id: 'delete',
      icon: Trash2,
      label: ui.chat.menu.delete,
      danger: true,
      separatorBefore: true,
      disabled: pending,
      run: actions.delete,
    },
  );
  // Пересланную копию нельзя править даже автору пересылки (#111): текст
  // принадлежит оригинальному автору — правка позволила бы исказить чужие
  // слова (модель Telegram: только удаление). Стикер (#143): править и
  // копировать нечего (текст пуст) — оба пункта скрываются.
  // «Удалить» на чужом — право модерации (#245): админ/владелец беседы или
  // модератор портала (группы/каналы; серверная проверка та же, I8).
  // Окно-источник (#237): только набор Telegram — copy/forward/select/
  // delete (в т.ч. без «Редактировать»: правка живёт в витрине).
  const isSticker = message.attachments.some((a) => a.kind === 'sticker');
  // Блок перехода (#380) — запись журнала, не текст: правка разошлась бы
  // с transition_records (сервер тоже отвечает 403).
  const editable =
    mine &&
    !message.forwardedFrom &&
    !isSticker &&
    message.kind !== 'task_transition' &&
    message.kind !== 'letter_transition' &&
    message.kind !== 'task_press' &&
    variant !== 'source-window';
  return {
    items: items.filter((item) => {
      if (item.id === 'edit') return editable;
      if (item.id === 'copy') return !isSticker;
      if (item.id === 'favorite') return !hideFavorite;
      if (item.id === 'delete') return mine || canModerate;
      if (variant === 'source-window') return SOURCE_WINDOW_ITEMS.has(item.id);
      return true;
    }),
    // «Кто просмотрел» — подменю (раунд 4): только свои живые сообщения с
    // непустым readBy (просмотры видит автор; пустой список показывать
    // нечего). Вставляется над «Удалить» (недеструктивная группа).
    showViewers:
      mine && variant !== 'source-window' && !message.deletedAt && message.readBy.length > 0,
  };
}
