import { z } from 'zod';

/**
 * Протокол моста «веб-приложение ↔ десктоп-оболочка» (ADR-0019).
 * Направление «веб → оболочка» — команды `window.nodusDesktop.*` (Tauri IPC,
 * capability выдаётся ровно origin'у портала в рантайме). Направление
 * «оболочка → веб» — события `window.__nodusDesktopInvoke(type, payload)`
 * (eval из Rust). Оболочка не переносит токены и креды — только команды
 * дисплея и навигации. Rust-сторона зеркалит эти схемы вручную
 * (apps/desktop/src-tauri/src/bridge.rs — рассинхрон = баг).
 */

/** Скачивание файла в оболочке (#647): карточка «Файл скачан» с кнопкой
 *  «Показать в папке». Абсолютный путь файла в контракт НЕ входит — оболочка
 *  держит его у себя (Rust) и сама проверяет каталог «Загрузки» перед
 *  открытием проводника; мини-UI знает только имя файла и факт успеха. */
export const popupDownloadSchema = z.object({
  /** Имя файла для показа (длинное переносится в две строки). */
  fileName: z.string().trim().min(1).max(255),
  /** Успех скачивания: false — карточка ошибки без кнопки. */
  success: z.boolean(),
});
export type PopupDownload = z.infer<typeof popupDownloadSchema>;

/** Запрос оболочке показать попап уведомления (стек право-низ, ADR-0019 п.4).
 *  Цель попапа — ровно ОДНА: беседа (сообщение чата), письмо (#618:
 *  «Поступило письмо» канцелярии) или скачанный файл (#647); клик открывает
 *  источник в портале, у скачивания клика нет — только кнопка «Показать
 *  в папке». */
export const popupPayloadSchema = z
  .object({
    /** Ключ дедупликации: id сообщения или уведомления журнала. */
    id: z.string().min(1).max(200),
    /** Беседа для «Открыть»/быстрого ответа (uuid). */
    conversationId: z.string().uuid().nullable().optional(),
    /** Письмо («Поступило письмо»): клик открывает карточку письма (#618). */
    letterId: z.string().uuid().nullable().optional(),
    /** Попап об ответе в трэде — корень трэда; клик раскрывает окно трэда (#300). */
    threadRootId: z.string().uuid().nullable().optional(),
    /** Заголовок попапа: имя автора или название беседы. */
    title: z.string().min(1).max(200),
    /** Аватар автора (абсолютный URL портала); пусто — графитовая заглушка. */
    avatarUrl: z.string().max(2000).optional(),
    /** Превью текста сообщения/уведомления. */
    preview: z.string().max(500),
    /** Превью — метка вложения («Фотография», #254): попап красит её акцентом. */
    previewAttachment: z.boolean().optional(),
    /** Важное (ADR-0016): попап висит до реакции, мигание критичное. */
    urgent: z.boolean(),
    /** Разрешён ли быстрый ответ из попапа (только личные/групповые беседы). */
    canReply: z.boolean(),
    /** Файл скачан (#647): карточка с кнопкой «Показать в папке». */
    download: popupDownloadSchema.nullable().optional(),
  })
  .refine((p) => [p.conversationId, p.letterId, p.download].filter(Boolean).length === 1, {
    message: 'цель попапа ровно одна: conversationId, letterId или download',
    path: ['conversationId'],
  });
export type PopupPayload = z.infer<typeof popupPayloadSchema>;

/** Информация об оболочке для веб-приложения (диагностика, поддержка). */
export const shellInfoSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  platform: z.string().min(1).max(30),
});
export type ShellInfo = z.infer<typeof shellInfoSchema>;

/** Событие «оболочка → веб»: ответ из попапа (текст уже подтверждён пользователем). */
export const popupReplyEventSchema = z.object({
  id: z.string().min(1).max(200),
  conversationId: z.string().uuid(),
  text: z.string().min(1).max(4000),
});
export type PopupReplyEvent = z.infer<typeof popupReplyEventSchema>;

/** Событие «оболочка → веб»: открыть беседу (deep link `nodus://chat/<id>` или кнопка попапа).
 * threadRootId — клик по попапу об ответе в трэде раскрывает окно трэда (#300). */
export const openConversationEventSchema = z.object({
  conversationId: z.string().uuid(),
  threadRootId: z.string().uuid().nullable().optional(),
});
export type OpenConversationEvent = z.infer<typeof openConversationEventSchema>;

/** Событие «оболочка → веб»: открыть письмо (клик по попапу «Поступило
 *  письмо», #618) — карточка письма поверх текущего раздела. */
export const openLetterEventSchema = z.object({
  letterId: z.string().uuid(),
});
export type OpenLetterEvent = z.infer<typeof openLetterEventSchema>;

/**
 * Событие «оболочка → веб»: видимость окна (скрытие в трей может не менять
 * `document.hidden` в WebView2 — портал обязан знать, что он «в фоне»).
 */
export const shellVisibilityEventSchema = z.object({
  visible: z.boolean(),
});
export type ShellVisibilityEvent = z.infer<typeof shellVisibilityEventSchema>;

/**
 * Состояние автообновления оболочки (пассивный поток #263): idle — обновления
 * нет/проверка не находила; downloading — скачивает; available — скачано и
 * ждёт решения пользователя (зелёная точка на кнопке «Скачать приложение»).
 */
export const shellUpdateStateSchema = z.object({
  status: z.enum(['idle', 'downloading', 'available']),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .nullable(),
});
export type ShellUpdateState = z.infer<typeof shellUpdateStateSchema>;

/** Каталог типов событий моста «оболочка → веб» (расширяется). */
export const DESKTOP_BRIDGE_EVENTS = {
  popupReply: 'popup-reply',
  openConversation: 'open-conversation',
  openLetter: 'open-letter',
  shellVisibility: 'shell-visibility',
  updateState: 'update-state',
} as const;
export type DesktopBridgeEventType =
  (typeof DESKTOP_BRIDGE_EVENTS)[keyof typeof DESKTOP_BRIDGE_EVENTS];
