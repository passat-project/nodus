/**
 * Строки предпросмотра публикации и подсказок имён (#430) — вынесены из
 * `ru-automation.ts` (I5): файл уже на пределе, а это самостоятельный блок.
 */
export const publishPreviewStrings = {
  publishWarnings: 'Проверьте перед публикацией:',
  /** Предпросмотр публикации (#430): кого затронет изменение. */
  publishAffectedTitle: 'Кого затронет',
  publishAffectedTypes: 'Типы',
  publishAffectedNoTypes: 'Маршрут пока не используется',
  publishAffectedInFlight: 'В полёте',
  publishAffectedNoTasks: 'Нет задач',
  publishAffectedNoLetters: 'Нет писем',
  publishAffectedTasks: ['задача', 'задачи', 'задач'],
  publishAffectedLetters: ['письмо', 'письма', 'писем'],
  /** Подсказки имён статусов (#430). */
  stageNameSuggestTitle: 'Имена из других маршрутов',
  stageNameSuggestEmpty: 'В этом этапе пока нет других имён',
  stageNameSuggestLoading: 'Загружаем имена…',
  stageNameSuggestFree: 'Можно ввести своё имя',
  stageNameSuggestCreate: 'Создать новое имя',
  stageNameSuggestRoutes: ['маршрут', 'маршрута', 'маршрутов'],
} as const;
