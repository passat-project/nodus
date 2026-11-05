import type { NotificationKind } from '../notifications/notifications.schemas.js';

/** UI-строки модуля уведомлений (#100): секция вынесена из ru.ts (I5). */
export const notificationsStrings = {
  /** Экран «Главная» — личный центр (вердикт 30.09: первый слот меню). */
  homeTitle: 'Главная',
  /** Заголовок ленты на Главной (личный старт: метрики-дела-люди). */
  feedTitle: 'УВЕДОМЛЕНИЯ',
  /** Деградация домена (I10/G4): журнал недоступен — витрина жива. */
  feedUnavailable: 'Журнал уведомлений недоступен',
  /** Секция важного: иерархия блоков = иерархия приоритетов (срочно → высокий → средний). */
  attentionSection: 'ТРЕБУЮТ ВНИМАНИЯ',
  lowSection: 'НИЗКИЙ ПРИОРИТЕТ',
  allClean: 'Всё разобрано',
  allCleanHint: 'Новых важных уведомлений нет',
  /** Табы-фильтры ленты (Slack-паттерн: один всегда активен) + окно «+» (#189).
   *  Терминология #177: пользователь видит ОДНО слово «Важное» везде
   *  (молния, чип пузыря, вкладка, метка приоритета); кодовые имена urgent. */
  pillAll: 'Все',
  pillUrgent: 'Важные',
  pillMentions: 'Упоминания',
  tabAdd: 'Настроить вкладки',
  tabsDialogTitle: 'Вкладки уведомлений',
  tabsDialogCreate: 'Новая вкладка',
  tabsDialogEdit: 'Вкладка',
  tabsNameLabel: 'Название',
  tabsNamePlaceholder: 'Например: Посты каналов',
  tabsPrioritiesLabel: 'Приоритеты',
  tabsKindsLabel: 'Типы событий',
  tabsSystemLabel: 'Системные вкладки',
  tabsSystemHint: 'Вкладка «Все» всегда доступна',
  tabsCreateButton: 'Создать',
  tabsSaveButton: 'Сохранить',
  tabsCancelButton: 'Отмена',
  tabsRename: 'Переименовать',
  tabsDelete: 'Удалить',
  tabsHide: 'Скрыть',
  tabNoResults: 'Ничего не найдено',
  tabAnyFilter: 'без фильтра — все события',
  /** Группировка по источнику (Telegram): счётчик в строке. */
  groupedMore: 'ещё',
  /** Cap отображения (E9). */
  overLimit: '999+',
  /** Метки приоритетов в строке (E11: контраст в обеих темах). */
  priorityUrgent: 'Важное',
  priorityHigh: 'Высокий',
  priorityMedium: 'Средний',
  priorityLow: 'Низкий',
  /** Заголовок строки по kind (без гендера: существительные). */
  kindTitles: {
    'urgent.message': 'Важное сообщение',
    'chat.direct_message': 'Личное сообщение',
    'chat.mention': 'Упоминание',
    'chat.thread_reply': 'Ответ в обсуждении',
    'chat.channel_post': 'Запись в канале',
    'chat.message_edited': 'Сообщение отредактировано',
    'action.assignment': 'Поручение',
    'action.approval': 'Согласование',
    'action.deadline': 'Срок',
    'action.decision': 'Ждёт вашего решения',
    'task.completed': 'Задача выполнена',
    'task.returned': 'Возврат в работу',
    'task.awaiting_approval': 'Ждёт утверждения',
    'task.cancelled': 'Задача отменена',
    'task.rejected': 'Работа отклонена',
    'task.approved': 'Работа принята',
    'letter.arrived': 'Поступило письмо',
    'mail.sync_failed': 'Почта не принимается',
    'letter.send_failed': 'Исходящее не отправлено',
  } satisfies Record<NotificationKind, string>,
  /** Колокольчик-поповер (быстрые последние 5–7; массового прочтения нет —
   *   важное гасится осознанно: входом в источник / «Ознакомлен», фидбек 01.10). */
  bellLabel: 'Уведомления',
  bellRecent: 'Последние уведомления',
  bellEmpty: 'Новых уведомлений нет',
  /** Союз счётчиков «N из M» (заряды молнии, счётчик попапа удалён). */
  ackStatusOf: 'из',
  /** Молния композера (#177, ревизия модели 05.10): клик = вкл/выкл
   *  «Важного» (канон Яндекса); состояние — цвет глифа; тултип объясняет
   *  остаток лимита (части собираются клиентом: urgentToday + ackStatusOf). */
  urgentToggle: 'Важное',
  urgentToggleHint: 'Верхний ярус уведомлений, пробивает «Не беспокоить»',
  urgentToday: 'Осталось важных сегодня:',
  urgentLimitReached: 'Лимит важных на сегодня исчерпан',
  /** Тосты: стак личного (каждое отдельно) / сводная карточка действий. */
  toastNewMessages: 'Новые сообщения',
  toastActionsSummary: 'Требуют внимания',
  toastUrgentRepeat: 'Напоминание',
  toastOpen: 'Открыть',
  /** DND-настройки (подавление тостов, кроме срочного). */
  settingsTitle: 'Уведомления',
  dndLabel: 'Не беспокоить',
  dndFrom: 'с',
  dndTo: 'по',
  dndHint: 'Тосты отключаются, важные сообщения пробиваются',
  /** Узкая панель деталей (фидбек владельца 01.10: не на весь экран). */
  detailTitle: 'Уведомление',
  detailOpenSource: 'Перейти к источнику',
  /** Onboarding (Linear-паттерн, первые дни). */
  onboardingTitle: 'Ваша Главная',
  onboardingBody:
    'Здесь собирается всё, что требует вашего внимания: важные сообщения, личные обращения и поручения. Низкий приоритет не отвлекает — он ниже, в свёрнутом журнале.',
};

export type NotificationsStrings = typeof notificationsStrings;
