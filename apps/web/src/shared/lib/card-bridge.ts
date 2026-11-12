/** Ссылка на карточку сущности (структурно совместима с CardRef каркаса). */
export interface CardBridgeRef {
  kind: string;
  id: string;
}

/** Rect источника в координатах вьюпорта — откуда «растёт» карточка
 *  (shared-element, ADR-0009). Структурно совместим с `SourceRect` слайдера:
 *  отдаём DOMRect прямо из `getBoundingClientRect` на клике (#728). */
export interface CardBridgeSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Мост к стеку карточек из shared-слоя (порт-адаптер, I13; аудит #45:
 * shared/chat/message-menu импортировал app/shell/use-card-stack — обратная
 * течь слоёв app → features → shared). Shared НЕ знает каркас: порт
 * объявлен здесь, реализацию регистрирует app-shell при старте
 * (registerCardBridge в AppShell). До регистрации — no-op (юнит-тесты
 * shared без каркаса).
 */
let opener: ((ref: CardBridgeRef, sourceRect?: CardBridgeSourceRect) => void) | null = null;

export function registerCardBridge(
  fn: (ref: CardBridgeRef, sourceRect?: CardBridgeSourceRect) => void,
): () => void {
  opener = fn;
  return () => {
    if (opener === fn) opener = null;
  };
}

export function openCardViaBridge(ref: CardBridgeRef, sourceRect?: CardBridgeSourceRect): void {
  opener?.(ref, sourceRect);
}

/** Цель подмены верхней мессенджер-карточки (вердикт 25.09, п.4): беседа
 *  приёмник пересылки/перехода + его тред. */
export interface MessengerCardTarget {
  conversationId: string;
  threadRootId: string | null;
}

let replaceTopMessenger: ((target: MessengerCardTarget) => boolean) | null = null;

export function registerReplaceTopMessenger(
  fn: (target: MessengerCardTarget) => boolean,
): () => void {
  replaceTopMessenger = fn;
  return () => {
    if (replaceTopMessenger === fn) replaceTopMessenger = null;
  };
}

/**
 * Заменить содержимое ВЕРХНЕЙ карточки, если она мессенджер (без ремаунта
 * панели, без вложенных слайдеров). false — верхняя карточка не мессенджер
 * (или стека нет): вызывающий решает следующий шаг маршрутизации.
 * До регистрации — false (юнит-тесты shared без каркаса).
 */
export function replaceTopMessengerCard(target: MessengerCardTarget): boolean {
  return replaceTopMessenger ? replaceTopMessenger(target) : false;
}
