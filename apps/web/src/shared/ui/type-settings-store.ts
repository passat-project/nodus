import { create } from 'zustand';

/**
 * Окно настроек типа (ревизия UI v3, #857) — один резидентный хост на раздел
 * «Автоматизация»: шестерёнка бара рамы, «⋯ → Настройки типа…» строки колонки
 * и меню строки списка просят хост открыть окно, не меняя выбор рамы
 * (прежде рама переезжала на тип счётчиком `settingsRequest`). Хост —
 * `TypeSettingsHost` уровня app (собирает окна трёх фич, I6); источник
 * запроса знает только `{ kind, id }`. Вид совпадает с видом карточки стека:
 * после архива хост закрывает и окно, и карточку этой сущности.
 */
export type TypeSettingsKind = 'process-type' | 'project-type' | 'node-kind';

export interface TypeSettingsTarget {
  kind: TypeSettingsKind;
  id: string;
}

interface TypeSettingsState {
  target: TypeSettingsTarget | null;
  openSettings: (target: TypeSettingsTarget) => void;
  closeSettings: () => void;
}

export const useTypeSettingsStore = create<TypeSettingsState>((set) => ({
  target: null,
  openSettings: (target) => set({ target }),
  closeSettings: () => set({ target: null }),
}));
