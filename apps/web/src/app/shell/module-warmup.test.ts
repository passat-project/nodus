// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { useUiPrefsStore } from '../../shared/preferences/ui-prefs-store.js';
import {
  networkAllowsWarmup,
  runModuleWarmup,
  warmupPlan,
  type WarmupEnv,
  type WarmupKey,
} from './module-warmup.js';

/**
 * Фоновый прогрев разделов (#1051): чанки видимых модулей и движок PDF
 * грузятся в свободное время, по одному, в личном порядке; ошибка одного
 * чанка не мешает остальным.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Среда с ручным управлением: idle и load отвечают только явным resolve. */
function manualEnv() {
  const events: string[] = [];
  const idles: ReturnType<typeof deferred<undefined>>[] = [];
  const loads: ReturnType<typeof deferred<unknown>>[] = [];
  const env: WarmupEnv = {
    idle: () => {
      events.push('idle');
      const slot = deferred<undefined>();
      idles.push(slot);
      return slot.promise;
    },
    allowed: () => true,
    load: (key: WarmupKey) => {
      events.push(`load:${key}`);
      const slot = deferred<unknown>();
      loads.push(slot);
      return slot.promise;
    },
  };
  return { env, events, idles, loads };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('module-warmup: план и ход прогрева (#1051)', () => {
  afterEach(() => {
    useUiPrefsStore.getState().resetPersonal();
  });

  it('план без личных настроек — модули рейки в системном порядке, последним движок PDF', () => {
    expect(warmupPlan()).toEqual([
      'home',
      'tasks',
      'letters',
      'crm',
      'projects',
      'chat',
      'employees',
      'automation',
      'pdf',
    ]);
  });

  it('личный порядок двигает вперёд, скрытые модули пропускаются, неизвестные id отброшены', () => {
    const personal = useUiPrefsStore.getState().personal;
    useUiPrefsStore.setState({
      personal: {
        ...personal,
        navOrder: ['chat', 'ghost', 'tasks'],
        navHidden: ['tasks', 'ghost'],
      },
    });
    const { navOrder, navHidden } = useUiPrefsStore.getState().personal;
    expect(warmupPlan(navOrder, navHidden)).toEqual([
      'chat',
      'home',
      'letters',
      'crm',
      'projects',
      'employees',
      'automation',
      'pdf',
    ]);
  });

  it('чанк грузится только в свободный момент и строго за предыдущим', async () => {
    const { env, events, idles, loads } = manualEnv();
    void runModuleWarmup(env);

    // До первого свободного момента — тишина.
    await tick();
    expect(events).toEqual(['idle']);

    idles[0]!.resolve(undefined);
    await tick();
    expect(events).toEqual(['idle', 'load:home']);

    // Чанк home ещё грузится: следующий свободный момент не запрашивается.
    await tick();
    expect(events).toEqual(['idle', 'load:home']);

    loads[0]!.resolve(undefined);
    await tick();
    await tick();
    expect(events).toEqual(['idle', 'load:home', 'idle']);

    idles[1]!.resolve(undefined);
    await tick();
    expect(events).toEqual(['idle', 'load:home', 'idle', 'load:tasks']);
  });

  it('ошибка одного чанка не останавливает прогрев и не выходит наружу', async () => {
    const keys = warmupPlan();
    const loaded: WarmupKey[] = [];
    const env: WarmupEnv = {
      idle: async () => {},
      allowed: () => true,
      load: async (key) => {
        loaded.push(key);
        if (key === keys[0] || key === 'pdf') throw new Error('404');
      },
    };

    await expect(runModuleWarmup(env)).resolves.toBeUndefined();
    expect(loaded).toEqual(keys);
  });

  it('экономия трафика — чанки придут по клику', async () => {
    const { env, events } = manualEnv();
    Object.assign(env, { allowed: () => false });

    await runModuleWarmup(env);
    expect(events).toEqual([]);
  });

  it('Data Saver и сети 2G отключают прогрев; обычная сеть и отсутствие данных — нет', () => {
    expect(networkAllowsWarmup({ saveData: true })).toBe(false);
    expect(networkAllowsWarmup({ effectiveType: '2g' })).toBe(false);
    expect(networkAllowsWarmup({ effectiveType: 'slow-2g' })).toBe(false);
    expect(networkAllowsWarmup({ saveData: false, effectiveType: '4g' })).toBe(true);
    expect(networkAllowsWarmup(undefined)).toBe(true);
    expect(networkAllowsWarmup({})).toBe(true);
  });
});
