import { create } from 'zustand';

import type { AttachmentPreviewKind } from '@nodus/contracts';

/**
 * Стор просмотрщика вложений (#138): один вьюер на приложение (хост — в
 * app-shell рядом с ChatDialogHosts). Инициатор (чип вложения в любом
 * хосте: пузырь чата, панель беседы, дровер задачи) кладёт цель в стор —
 * без прокидывания состояния через props. Паттерн — dialog-stores чата.
 */
export interface ViewerTarget {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  /** Подписанная ссылка контента (относительная, same-origin). */
  url: string | null;
  /** Маршрут просмотрщика с сервера (#139); undefined — старый DTO без
   * классификации (реестр вычислит локально). */
  previewKind?: AttachmentPreviewKind;
  /** PDF-копия офисного документа (#139): fallback при выключенном движке;
   * 404 по ссылке = копия ещё не готова. */
  pdfUrl?: string | null;
}

interface ViewerState {
  target: ViewerTarget | null;
  /** Кому вернуть фокус после закрытия (#1005): снимок делается в `open()`,
   *  пока активен триггер. К моменту закрытия activeElement — уже плеер или
   *  кнопка внутри портала, и «снять фокус при открытии» не годится. */
  returnFocus: HTMLElement | null;
  open: (target: ViewerTarget) => void;
  close: () => void;
}

/** Текущий фокус документа (в jsdom/без document — null). */
function focusedElement(): HTMLElement | null {
  return typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
}

export const useViewerStore = create<ViewerState>((set) => ({
  target: null,
  returnFocus: null,
  open: (target) => set({ target, returnFocus: focusedElement() }),
  close: () => set({ target: null }),
}));
