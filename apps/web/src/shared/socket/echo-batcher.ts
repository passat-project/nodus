import { useAuthStore } from '../auth-store.js';
import {
  createKeyBatcher,
  type InvalidationTier,
  type KeyBatcher,
} from './invalidation-batcher.js';

/**
 * Батчер инвалидаций, помнящий КТО принёс ключ (#1051). Сервер шлёт событие и
 * актёру: после собственной мутации её эхо инвалидирует то, что уже перезапрошено
 * по ответу, — второй раунд той же волны. Прежде окно гасилось по одному лишь
 * факту «ключ перезапрошен недавно» — и правка КОЛЛЕГИ по той же задаче в те
 * же две секунды терялась. Теперь гасится только эхо текущего пользователя;
 * чужое событие, событие без автора (старый gateway, системный таймер) и ключ
 * с пометкой `force` проходят всегда.
 */

/** Что известно о ключе к моменту закрытия окна. */
export interface EchoMark {
  /** Ключ принесли ТОЛЬКО события текущего пользователя. */
  ownOnly: boolean;
  /** Куст бесед перечитать целиком, не только списки. */
  wide: boolean;
}

export interface PushOptions {
  /** Не считать своё: значение меняется на сервере ПОСЛЕ ответа мутации
   *  (формульная запись) — автору нужно перечитать. */
  force?: boolean;
  wide?: boolean;
}

export interface EchoAwareBatcher extends KeyBatcher {
  push: (key: readonly unknown[], tier: InvalidationTier, options?: PushOptions) => void;
}

type Invalidate = (key: readonly unknown[], mark: EchoMark | undefined) => void;

/** Событие совершено текущим пользователем (нет автора — нет и своего эха). */
export function isOwnEvent(actorId: string | null): boolean {
  return actorId !== null && actorId === useAuthStore.getState().user?.id;
}

export function createEchoBatcher(invalidate: Invalidate): {
  /** Окно батчера для одного события: все его ключи помечены автором. */
  forEvent: (actorId: string | null) => EchoAwareBatcher;
  flush: () => void;
  dispose: () => void;
} {
  const marks = new Map<string, EchoMark>();
  const batcher = createKeyBatcher((key) => {
    const stamp = JSON.stringify(key);
    const mark = marks.get(stamp);
    marks.delete(stamp);
    invalidate(key, mark);
  });

  return {
    forEvent(actorId) {
      return {
        push(key, tier, options = {}) {
          const stamp = JSON.stringify(key);
          const own = isOwnEvent(actorId) && options.force !== true;
          const before = marks.get(stamp);
          marks.set(stamp, {
            // Чужой среди своих снимает гашение; свой среди чужих его не возвращает.
            ownOnly: before === undefined ? own : before.ownOnly && own,
            wide: (before?.wide ?? false) || options.wide === true,
          });
          batcher.push(key, tier);
        },
        flush: batcher.flush,
        dispose: () => {
          batcher.dispose();
          marks.clear();
        },
      };
    },
    flush: batcher.flush,
    dispose: () => {
      batcher.dispose();
      marks.clear();
    },
  };
}
