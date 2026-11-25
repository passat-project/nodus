// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUiPrefsStore } from '../../shared/preferences/ui-prefs-store.js';
import { prefetchPersonalBoard } from '../../features/tasks/api/tasks-board-prefetch.js';
import { queryClient } from '../../shared/lib/query-client.js';
import { PAGE_IMPORTS } from '../page-imports.js';
import {
  browserEnv,
  networkAllowsWarmup,
  runModuleWarmup,
  startModuleWarmup,
  warmupPlan,
  type WarmupEnv,
  type WarmupKey,
} from './module-warmup.js';

// Движок PDF в тесте не нужен: импорт подменён, грузится сама ветка `load('pdf')`.
vi.mock('../../shared/files/pdf-viewer.js', () => ({ PdfViewer: () => null }));
// Данные «Задач» в кэш — импорт подменён: проверяем вызов, не сеть.
vi.mock('../../features/tasks/api/tasks-board-prefetch.js', () => ({
  prefetchPersonalBoard: vi.fn(async () => undefined),
}));

/** Свободные моменты браузера под ручным управлением: колбэк зовёт тест. */
function idleSink() {
  const idled: Array<{ fire: () => void; timeout: number | undefined }> = [];
  vi.stubGlobal('requestIdleCallback', (cb: () => void, options?: { timeout?: number }) => {
    idled.push({ fire: cb, timeout: options?.timeout });
    return idled.length;
  });
  return idled;
}

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

  it('браузерная среда: пауза до первого чанка, дальше — свободный момент за свободным', async () => {
    vi.useFakeTimers();
    const idled = idleSink();
    const tasks = vi.spyOn(PAGE_IMPORTS, 'tasks').mockResolvedValue({ default: () => null });
    try {
      const env = browserEnv();

      const first = env.idle();
      await vi.advanceTimersByTimeAsync(1_499);
      expect(idled).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(idled[0]?.timeout).toBe(4_000); // без простоя под непрерывным вводом
      idled[0]!.fire();
      await first;

      const second = env.idle();
      expect(idled).toHaveLength(2);
      idled[1]!.fire();
      await second;

      expect(env.allowed()).toBe(true);
      await env.load('tasks');
      await env.load('pdf');
      expect(tasks).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('без requestIdleCallback свободный момент — таймер; Data Saver выключает прогрев', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    try {
      const env = browserEnv();
      const first = env.idle();
      await vi.advanceTimersByTimeAsync(1_500 + 500);
      await first;

      // Data Saver в браузере — прогрев выключен (jsdom даёт navigator без connection).
      Object.defineProperty(navigator, 'connection', {
        value: { saveData: true },
        configurable: true,
      });
      try {
        expect(env.allowed()).toBe(false);
      } finally {
        Reflect.deleteProperty(navigator, 'connection');
      }
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('startModuleWarmup: один запуск на страницу; чанк — после паузы и в свободный момент', async () => {
    vi.useFakeTimers();
    const idled = idleSink();
    const home = vi.spyOn(PAGE_IMPORTS, 'home').mockResolvedValue({ default: () => null });
    try {
      void startModuleWarmup();
      expect(home).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(home).not.toHaveBeenCalled(); // ждёт свободного момента
      idled[0]!.fire();
      await vi.advanceTimersByTimeAsync(0);
      expect(home).toHaveBeenCalledTimes(1);

      // Второй вызов ничего не грузит: прогрев уже идёт.
      await startModuleWarmup();
      expect(idled).toHaveLength(2);
      expect(home).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe('прогрев данных раздела (#1051)', () => {
  afterEach(() => vi.clearAllMocks());

  it('данные раздела грузятся после его чанка; следующий раздел ждёт их', async () => {
    const order: string[] = [];
    const release = deferred<void>();
    const env: WarmupEnv = {
      idle: async () => undefined,
      allowed: () => true,
      load: async (key) => {
        order.push(`chunk:${key}`);
      },
      data: async (key) => {
        order.push(`data:${key}`);
        // Данные «Задач» не отвечают, пока тест не разрешит.
        if (key === 'tasks') await release.promise;
      },
    };

    const done = runModuleWarmup(env);
    await vi.waitFor(() => expect(order).toContain('data:tasks'));
    const plan = warmupPlan();
    const afterTasks = plan[plan.indexOf('tasks') + 1];
    expect(order).not.toContain(`chunk:${afterTasks}`);

    release.resolve();
    await done;
    // Каждому чанку раздела — свой шаг данных, в том же порядке.
    expect(order.filter((x) => x.startsWith('data:'))).toEqual(plan.map((key) => `data:${key}`));
  });

  it('отказ данных раздела не мешает остальным', async () => {
    const loaded: string[] = [];
    await runModuleWarmup({
      idle: async () => undefined,
      allowed: () => true,
      load: async (key) => {
        loaded.push(key);
      },
      data: async (key) => {
        if (key === 'tasks') throw new Error('500');
      },
    });
    expect(loaded).toEqual(warmupPlan());
  });

  it('в браузере данные «Задач» — это доска в кэш; у остальных разделов данных нет', async () => {
    vi.mocked(prefetchPersonalBoard).mockClear();
    await browserEnv().data?.('tasks');
    await browserEnv().data?.('pdf');
    expect(prefetchPersonalBoard).toHaveBeenCalledTimes(1);
    expect(prefetchPersonalBoard).toHaveBeenCalledWith(queryClient);
  });
});
