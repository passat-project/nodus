import { openCardViaBridge, type CardBridgeSourceRect } from '../lib/card-bridge.js';

/**
 * Профиль сотрудника из мессенджера (#972): карточка должна открываться как
 * ПРОФИЛЬ — стартовой вкладкой «Задачи», а не копией текущего диалога (в
 * личном чате переход на «Чат» выглядел как «ничего не произошло», в группе
 * правая зона дублировала мессенджер). Стек карточек (`?cards=`) несёт только
 * `{kind,id}`, поэтому стартовая вкладка «пристаивается» здесь — по образцу
 * messenger-nav.ts: новая карточка потребляет пристойку на маунте, уже
 * открытая — по подписке (openCard на той же верхней карточке — no-op).
 *
 * Модуль-level состояние: потребление одноразовое и только для своего
 * сотрудника (несколько кликов подряд не должны затирать пристойку друг друга).
 */

/** Стартовая вкладка карточки сотрудника для внешнего открытия (только
 *  мессенджер; из «Сотрудников» карточка по-прежнему стартует с «Чата»). */
export type EmployeeCardStartTab = 'tasks';

const staged = new Map<string, EmployeeCardStartTab>();
const listeners = new Set<() => void>();

export function stageEmployeeCardTab(userId: string, tab: EmployeeCardStartTab): void {
  staged.set(userId, tab);
  for (const fn of listeners) fn();
}

/** Забрать стартовую вкладку сотрудника (одноразово). */
export function takeEmployeeCardTab(userId: string): EmployeeCardStartTab | null {
  const tab = staged.get(userId);
  if (!tab) return null;
  staged.delete(userId);
  return tab;
}

/** Подписка живой карточки: клик при уже открытой карточке тоже меняет
 *  вкладку (openCard в этом случае — no-op, без подписки пристойка зависла бы). */
export function subscribeEmployeeCardTab(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Единый вход в профиль из мессенджера: аватар сообщения, панель участников,
 *  чип @упоминания, шапка личного чата. rect источника — shared-element FLIP
 *  (карточка раскрывается из кликнутого места, закрытие возвращает в чат). */
export function openEmployeeCardFromChat(userId: string, sourceRect?: CardBridgeSourceRect): void {
  stageEmployeeCardTab(userId, 'tasks');
  openCardViaBridge({ kind: 'employee', id: userId }, sourceRect);
}
