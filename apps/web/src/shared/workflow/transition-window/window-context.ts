import type {
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldValues,
  TaskAccess,
  UserRef,
} from '@nodus/contracts';

/** Значения полей карточки, которые окно может дозаполнить (#380).
 *  Кастомные поля (#431) — в тех же полях по id определения. */
export interface WindowFieldValues {
  description: string;
  /** ISO datetime; null — срока нет. */
  deadline: string | null;
  assigneeId: string | null;
  plannedMinutes: number | null;
  customFields: CustomFieldValues;
}

/** Сдача исполнителя для блока «Что сдаёт исполнитель». */
export interface WindowSubmission {
  author: UserRef;
  result: { text: string; messageIds: string[] };
  createdAt: string;
}

/**
 * Контекст окна перехода (#380): всё, что окно знает о сущности. Окно не
 * импортирует задачу — карточка собирает контекст; задел #434: «моя отметка»
 * = другой контекст и `scope`, те же разделы. Определения полей области
 * (#431) приходят готовыми: окно не знает модуля custom-fields.
 */
export interface TransitionWindowContext {
  entityId: string;
  /** Беседа задачи (файлы и сообщения — вложения её чата, канон #252). */
  conversationId: string | null;
  currentStageName: string;
  fields: WindowFieldValues;
  spentMinutes: number;
  /** Последняя ревизия итога (префилл и перенос её сообщений). */
  lastResult: { text: string; messageIds: string[] } | null;
  access: Pick<TaskAccess, 'canEdit' | 'canLogTime' | 'canCheck'>;
  /** Этап «Утверждение» и есть итог — блок сдачи сверху. */
  submission: WindowSubmission | null;
  scope: 'entity';
  /** Видимые атрибуты области — для раздела «Поля» окна (Р7; скрытые окно не показывает). */
  customFieldDefinitions: readonly CustomFieldDefinition[];
  /** Ссылки значений (имя/аватар) — показ выбранного до ответа сервера. */
  customFieldRefs: readonly CustomFieldRef[];
  /** Возврат в статус с коллективной кнопкой (#434, В2): кому вернуть. */
  pressReturn?: {
    candidates: readonly { userId: string; displayName: string; state: string }[];
    defaultUserIds: readonly string[];
  };
}
