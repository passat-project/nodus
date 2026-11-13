import type { ChatMessage, MessageAttachment, ReplyPreview } from '@nodus/contracts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { chatDraftsPersistOptions } from './chat-drafts-persist.js';
import {
  applyEditToMentions,
  fromWireText,
  insertMentionDraft,
  removeMentionDraft,
  replaceMentionLabelDraft,
  type DraftMention,
} from './composer-mention-registry.js';
import {
  pendingRowFromAttachment,
  restoreFailedIntoDraft,
  type FailedSendRestore,
} from './draft-restore.js';
import { replyDraftFrom, replyDraftFromPreview, type ReplyDraft } from './reply-snapshot.js';

export type { ReplyDraft } from './reply-snapshot.js';

/**
 * Черновики композера per-conversation (#87, вердикт владельца 24.09:
 * индикатор черновика нужен сейчас). Ключ — draftKey композера
 * (`conversation:<id>` / `feed:<id>` / `thread:<rootId>`): текст, контекст
 * ответа/правки и трей вложений НЕ теряются при переключении бесед.
 * Персист: только текст и серализуемый контекст (reply/edit) — вложения
 * живут в памяти сессии (канон research: ни один мессенджер не восстанавливает
 * файлы черновика после перезагрузки). Пустой черновик удаляется из стора —
 * индикатор в списке бесед гаснет.
 */

export interface PendingAttachment {
  localId: string;
  fileName: string;
  mime: string;
  size: number;
  /** 0..1 — для кольца/бара прогресса. */
  progress: number;
  /** `processing` — тело уже принято сервером, но ответа ещё нет: сервер
   *  стримит файл в хранилище и пишет строки БД (#717). Отдельное состояние,
   *  чтобы окно объясняло паузу, а не выглядело залипшим на 100%. */
  status: 'uploading' | 'processing' | 'ready' | 'error';
  /** Заполняется по завершении загрузки (attachmentIds отправки). */
  attachment: MessageAttachment | null;
  /** Превью трей (локальный objectURL изображения). */
  objectUrl: string | null;
}

export interface EditDraft {
  messageId: string;
  originalText: string;
  /** Вложения правимого сообщения на момент входа в правку (#188): отличить
   *  строки сообщения (крестик — локальный detach) от новых загрузок
   *  (крестик — отмена на сервере). */
  originalIds: string[];
}

export interface ChatDraft {
  /** ВИДИМЫЙ текст поля (#228): просто ИМЯ сотрудника в месте чипа —
   *  каретка/клики нативны; wire-токены пересобираются на отправке. */
  text: string;
  /** Привязки чипов-упоминаний к диапазонам display-текста (#228). */
  mentions: DraftMention[];
  reply: ReplyDraft | null;
  edit: EditDraft | null;
  /** Текст композера до входа в режим правки — восстанавливается отменой. */
  preEditText: string | null;
  /** Реестр упоминаний до входа в правку — восстанавливается отменой (#228). */
  preEditMentions: DraftMention[] | null;
  attachments: PendingAttachment[];
  /** «Важное» (#177, ревизия 05.10): клик молнии — простой тоггл.
   *  Сессионное состояние — НЕ персистится (после перезагрузки молния
   *  выключена: случайного важного нет). */
  urgent: boolean;
}

export const EMPTY_DRAFT: ChatDraft = {
  text: '',
  mentions: [],
  reply: null,
  edit: null,
  preEditText: null,
  preEditMentions: null,
  attachments: [],
  urgent: false,
};

export interface DraftsState {
  drafts: Record<string, ChatDraft>;
  setText: (key: string, text: string) => void;
  /** Вставка чипа упоминания (#228): замена @запроса + регистрация привязки. */
  insertMention: (
    key: string,
    atStart: number,
    atEnd: number,
    id: string,
    label: string,
  ) => number | null;
  /** Правка label чипа поповером (#228). */
  renameMention: (key: string, index: number, label: string) => boolean;
  /** Удаление чипа целиком (корзина поповера, #228). */
  removeMention: (key: string, index: number) => void;
  /** Восстановление серверного черновика (#228): wire → display + реестр. */
  restoreFromWire: (key: string, wire: string) => void;
  /** Режимы ответа и правки взаимоисключающие (канон tdesktop: один _editMsgId). */
  setReply: (key: string, message: ChatMessage, quoteText?: string | null) => void;
  cancelReply: (key: string) => void;
  setEdit: (key: string, message: ChatMessage) => void;
  cancelEdit: (key: string) => void;
  /** Правка сохранена/отправлена: режим снят, восстановлен исходный текст. */
  finishEdit: (key: string) => void;
  addAttachments: (key: string, items: PendingAttachment[]) => void;
  /** Замена вложения на месте (#188): новая строка встаёт на позицию старой. */
  insertAttachment: (key: string, index: number, item: PendingAttachment) => void;
  patchAttachment: (key: string, localId: string, patch: Partial<PendingAttachment>) => void;
  removeAttachment: (key: string, localId: string) => void;
  /** Сортировка окна отправки (#144): порядок строк = порядок attachmentIds. */
  reorderAttachments: (key: string, from: number, to: number) => void;
  /** Отмена окна отправки (#144): вложения сняты целиком (blob-URL освобождены). */
  clearAttachments: (key: string) => void;
  /** Молния «Важное» (#177): клик — вкл/выкл. */
  setUrgent: (key: string, urgent: boolean) => void;
  /** Возврат упавшей отправки в поле (#248): пустое поле — состав целиком
   *  (текст с чипами, ответ, молния, вложения), занятое следующим набором —
   *  упавший текст в начало плоским текстом + вложения. Логика — draft-restore. */
  restoreFailedSend: (key: string, failed: FailedSendRestore) => void;
  /** Возврат ответа упавшей СТИКЕР-отправки (#288): keepDraft-путь поле не
   *  трогает (текст и вложения живы), но потреблённый сабмитом ответ
   *  возвращается (канон #124 — потерянного нет). null — снять ответ. */
  restoreReply: (key: string, preview: ReplyPreview | null) => void;
  clear: (key: string) => void;
}

function prune(draft: ChatDraft): ChatDraft | null {
  // Молния (#177) держит черновик живым — иначе тоггл на пустом поле
  // мгновенно вычищался бы из стора; индикатор в списке смотрит на
  // СЕРВЕРНЫЙ draft.text и от сессионного urgent не зажигается.
  const empty =
    draft.text === '' &&
    (draft.mentions ?? []).length === 0 &&
    !draft.reply &&
    !draft.edit &&
    draft.attachments.length === 0 &&
    !draft.urgent;
  return empty ? null : draft;
}

function patchDraft(
  drafts: Record<string, ChatDraft>,
  key: string,
  fn: (draft: ChatDraft) => ChatDraft,
): Record<string, ChatDraft> {
  const next = fn(drafts[key] ?? EMPTY_DRAFT);
  const pruned = prune(next);
  const result = { ...drafts };
  if (pruned) result[key] = pruned;
  else delete result[key];
  return result;
}

export const useChatDrafts = create<DraftsState>()(
  persist(
    (set) => ({
      drafts: {},
      setText: (key, text) =>
        set((s) => ({
          // Реестр упоминаний следует за правкой текста (#228): сдвиги/
          // инвалидации — диффом registry; прямые присваивания (клир,
          // вставка эмодзи, правка) обслуживаются тем же путём.
          drafts: patchDraft(s.drafts, key, (d) => ({
            ...d,
            mentions: applyEditToMentions(d.mentions ?? [], d.text, text),
            text,
          })),
        })),
      insertMention: (key, atStart, atEnd, id, label) => {
        let caret: number | null = null;
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => {
            const res = insertMentionDraft(d.text, d.mentions ?? [], atStart, atEnd, id, label);
            if (!res) return d;
            caret = res.caret;
            return { ...d, text: res.text, mentions: res.mentions };
          }),
        }));
        return caret;
      },
      renameMention: (key, index, label) => {
        let ok = false;
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => {
            const res = replaceMentionLabelDraft(d.text, d.mentions ?? [], index, label);
            if (!res) return d;
            ok = true;
            return { ...d, text: res.text, mentions: res.mentions };
          }),
        }));
        return ok;
      },
      removeMention: (key, index) => {
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => {
            const res = removeMentionDraft(d.text, d.mentions ?? [], index);
            return { ...d, text: res.text, mentions: res.mentions };
          }),
        }));
      },
      restoreFromWire: (key, wire) => {
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => {
            const parsed = fromWireText(wire);
            return { ...d, text: parsed.text, mentions: parsed.mentions };
          }),
        }));
      },
      setReply: (key, message, quoteText) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => ({
            ...d,
            // Вход в ответ из режима правки — правка отменяется (текст правки
            // не теряется: tdesktop-поведение не подтверждено, выбираем
            // безопасное — снимаем режим, preEdit восстанавливается).
            edit: null,
            preEditText: d.edit ? d.preEditText : null,
            preEditMentions: d.edit ? d.preEditMentions : null,
            text: d.edit ? (d.preEditText ?? '') : d.text,
            mentions: d.edit ? (d.preEditMentions ?? []) : (d.mentions ?? []),
            reply: replyDraftFrom(message, quoteText),
          })),
        })),
      cancelReply: (key) =>
        set((s) => ({ drafts: patchDraft(s.drafts, key, (d) => ({ ...d, reply: null })) })),
      setEdit: (key, message) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => ({
            ...d,
            reply: null,
            edit: {
              messageId: message.id,
              originalText: message.text,
              originalIds: message.attachments.map((a) => a.id),
            },
            preEditText: d.edit ? d.preEditText : d.text,
            preEditMentions: d.edit ? d.preEditMentions : (d.mentions ?? []),
            // Правка открывается ВИДИМЫМ текстом (#228): токены сообщения
            // разбираются в display + реестр, отправка пересоберёт wire.
            text: fromWireText(message.text).text,
            mentions: fromWireText(message.text).mentions,
            // Вложения правимого сообщения — строки окна правки (#188):
            // ready-карточки с серверным DTO (id строки = localId).
            attachments: message.attachments.map((a) => pendingRowFromAttachment(a)),
          })),
        })),
      cancelEdit: (key) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) =>
            d.edit
              ? {
                  ...d,
                  edit: null,
                  text: d.preEditText ?? '',
                  mentions: d.preEditMentions ?? [],
                  preEditText: null,
                  preEditMentions: null,
                }
              : d,
          ),
        })),
      finishEdit: (key) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => {
            // Правка сохранена: состав окна съеден сообщением — objectURL
            // превью новых загрузок освобождаем (#188).
            for (const gone of d.attachments) {
              if (gone.objectUrl) URL.revokeObjectURL(gone.objectUrl);
            }
            return {
              ...d,
              edit: null,
              text: d.preEditText ?? '',
              mentions: d.preEditMentions ?? [],
              preEditText: null,
              preEditMentions: null,
              attachments: [],
            };
          }),
        })),
      addAttachments: (key, items) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => ({
            ...d,
            attachments: [...d.attachments, ...items],
          })),
        })),
      insertAttachment: (key, index, item) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => {
            const attachments = [...d.attachments];
            const at = Math.max(0, Math.min(index, attachments.length));
            attachments.splice(at, 0, item);
            return { ...d, attachments };
          }),
        })),
      patchAttachment: (key, localId, patch) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => ({
            ...d,
            attachments: d.attachments.map((a) => (a.localId === localId ? { ...a, ...patch } : a)),
          })),
        })),
      removeAttachment: (key, localId) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => {
            // Превью снятого файла больше не показывается — blob-URL
            // освобождается (находка валидатора 24.09). НЕ ревочит только
            // clear() черновика после ОТПРАВКИ: objectUrl живёт в превью
            // отправленного сообщения мок-стора; clearAttachments (отмена
            // окна — файлы никуда не ушли) ревочит весь состав.
            const gone = d.attachments.find((a) => a.localId === localId);
            if (gone?.objectUrl) URL.revokeObjectURL(gone.objectUrl);
            return {
              ...d,
              attachments: d.attachments.filter((a) => a.localId !== localId),
            };
          }),
        })),
      reorderAttachments: (key, from, to) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => {
            const attachments = [...d.attachments];
            const [moved] = attachments.splice(from, 1);
            if (!moved) return d;
            attachments.splice(to, 0, moved);
            return { ...d, attachments };
          }),
        })),
      clearAttachments: (key) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => {
            for (const gone of d.attachments) {
              if (gone.objectUrl) URL.revokeObjectURL(gone.objectUrl);
            }
            return { ...d, attachments: [] };
          }),
        })),
      setUrgent: (key, urgent) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => ({ ...d, urgent })),
        })),
      restoreFailedSend: (key, failed) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => restoreFailedIntoDraft(d, failed)),
        })),
      restoreReply: (key, preview) =>
        set((s) => ({
          drafts: patchDraft(s.drafts, key, (d) => ({
            ...d,
            // Канон restore #248: ответ, начатый ПОЛЬЗОВАТЕЛЕМ за полёт,
            // сильнее возвращаемого упавшей отправкой — затирать нельзя.
            reply: d.reply ?? (preview ? replyDraftFromPreview(preview) : null),
          })),
        })),
      clear: (key) => set((s) => ({ drafts: patchDraft(s.drafts, key, () => EMPTY_DRAFT) })),
    }),
    chatDraftsPersistOptions,
  ),
);
