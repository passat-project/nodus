import { useSyncExternalStore } from 'react';

/**
 * Реестр модальных слоёв (#809, продолжение модели внимания ADR-0038).
 * Видимость поверхности (`surface-visibility.tsx`) отвечает на вопрос
 * «карточка накрыта карточкой/вкладкой», но НЕ знает про слои поверх неё:
 * просмотрщик вложения, «кинозал», лайтбокс, окна Radix (Ctrl+K, создание
 * задачи, диалоги чата). Пока такой слой открыт, чат под ним не виден —
 * квитанции прочтения и гейты попапов обязаны молчать.
 *
 * Источник признака — DOM: все модальные окна портала рендерятся нашими
 * примитивами (`data-slot="dialog-content"` — Radix Dialog, `sheet-content` —
 * Sheet) или полноэкранными порталами с `aria-modal="true"`; отдельный
 * враппер на 200+ вызовов `DialogContent` не нужен. Карточка-поверхность
 * (`data-card-surface`) тоже объявлена `aria-modal`, но слоем НЕ является —
 * её видимость несут `SurfaceVisibilityProvider`'ы.
 *
 * Мелкие поповеры (меню, эмодзи, тултипы, контекстное меню) в реестр не
 * попадают: они не перекрывают ленту и не отменяют «смотрю в чат».
 */

/** Селектор слоёв: модальные примитивы портала + полноэкранные порталы. */
const MODAL_SELECTOR =
  '[data-slot="dialog-content"], [data-slot="sheet-content"], [aria-modal="true"]';

/** Маркер карточки-поверхности (SliderPanel): не слой, а носитель видимости. */
const SURFACE_MARKER = 'data-card-surface';

const layers = new Set<Element>();
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/** Признак «поверхность перекрыта модальным слоем» (снимок для гейтов). */
export function isModalLayerOpen(): boolean {
  return layers.size > 0;
}

/** Подписка на появление/закрытие слоёв (гейты пересчитываются на переходе). */
export function subscribeModalLayers(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Явная регистрация слоя (основной API и точка для своих порталов без
 * `aria-modal`); возвращает release. Дедупликация по элементу: повторный
 * вызов — no-op, разные слои считаются независимо (Set, а не счётчик —
 * React StrictMode не плодит двойных «закрытий»).
 */
export function registerModalLayer(element: Element): () => void {
  if (!layers.has(element)) {
    layers.add(element);
    notify();
  }
  return () => {
    if (layers.delete(element)) notify();
  };
}

function isLayerNode(element: Element): boolean {
  // Карточка-поверхность и её содержимое — не слой: `closest` отсекает
  // вложенные aria-modal внутри карточки (например, окно над карточкой — оно
  // слой, но объявлено вне `data-card-surface`; защита от случайной разметки).
  if (element.closest(`[${SURFACE_MARKER}]`) !== null) return false;
  return element.matches(MODAL_SELECTOR);
}

/** Проверить добавленный узел и его потомков (порталы добавляются поддеревом). */
function scanAdded(node: Node): void {
  if (!(node instanceof Element)) return;
  if (isLayerNode(node)) registerModalLayer(node);
  for (const child of node.querySelectorAll(MODAL_SELECTOR)) {
    if (isLayerNode(child)) registerModalLayer(child);
  }
}

/** Убрать из реестра отключённые слои (анмаунт/закрытие любого предка). */
function pruneDetached(): void {
  let changed = false;
  for (const element of [...layers]) {
    if (!element.isConnected) {
      layers.delete(element);
      changed = true;
    }
  }
  if (changed) notify();
}

/**
 * Начать слежение за DOM (идемпотентно; зовётся хостом приложения). Возврат —
 * остановка: используется тестами и размонтированием оболочки.
 */
export function startModalLayerTracking(): () => void {
  if (typeof document === 'undefined' || observer !== null) return () => undefined;
  // Уже смонтированные слои (старт после первого рендера) — учесть сразу.
  for (const element of document.querySelectorAll(MODAL_SELECTOR)) {
    if (isLayerNode(element)) registerModalLayer(element);
  }
  observer = new MutationObserver((mutations) => {
    let removed = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) scanAdded(node);
      if (mutation.removedNodes.length > 0) removed = true;
    }
    if (removed) pruneDetached();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return stopModalLayerTracking;
}

export function stopModalLayerTracking(): void {
  observer?.disconnect();
  observer = null;
  if (layers.size > 0) {
    layers.clear();
    notify();
  }
}

/** React-подписка: перерисовка гейтов на открытие/закрытие слоя. */
export function useModalLayerCovered(): boolean {
  return useSyncExternalStore(subscribeModalLayers, isModalLayerOpen, () => false);
}

/** Сброс реестра (только тесты): детерминированное «слоёв нет». */
export function resetModalLayersForTests(): void {
  stopModalLayerTracking();
}
