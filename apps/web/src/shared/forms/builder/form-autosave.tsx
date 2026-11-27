import { useEffect, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from '@nodus/ui/components/button';

import type { BuilderValue } from './builder-model.js';

const b = ui.forms.builder;

/** Пауза между правкой и сохранением: серия правок уходит одним запросом. */
export const AUTOSAVE_DELAY_MS = 600;

/** `idle` — всё сохранено; `waiting` — таймер до запроса; `saving` — запрос в
 *  полёте; `error` — сервер не принял, черновик на месте; `blocked` — правка не
 *  уходит (пустой заголовок/пояснение), сохранение ждёт следующей правки. */
export type FormSaveState = 'idle' | 'waiting' | 'saving' | 'error' | 'blocked';

interface Draft<V> {
  value: V;
  failed: boolean;
}

/** Черновики, не ушедшие на сервер (ошибка или незавершённая правка), по ключу
 *  сущности: переживают уход с вкладки и возврат — правка не теряется молча,
 *  на месте её ждёт «Не сохранилось» или подсказка. */
const unsaved = new Map<string, Draft<unknown>>();

function draftOf<V>(key: string): Draft<V> | undefined {
  return unsaved.get(key) as Draft<V> | undefined;
}

interface Live<V> {
  /** Последняя правка (`null` — всё сохранено). */
  draft: V | null;
  /** Правка сделана при жизни этой вкладки и ещё не отказана сервером:
   *  уходя, сохраняем только такую (ошибка — решение за сотрудником:
   *  черновик ждёт «Повторить» или новой правки). */
  edited: boolean;
  busy: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface Control<V> {
  edit: (next: V) => void;
  retry: () => void;
  /** Сохранить недавнюю правку сразу — уход с вкладки или смена сущности. */
  flush: () => void;
}

interface Latest<V> {
  save: (next: V) => Promise<void>;
  isBlocked: (next: V) => boolean;
}

/** Результат хука: управление автосохранением, значение листа и его состояние. */
export interface FormAutosave<X> extends Control<BuilderValue<X>> {
  /** Что показывает лист: несохранённая правка или форма с сервера. */
  value: BuilderValue<X>;
  state: FormSaveState;
}

/** Один запрос в полёте: пока он идёт, новая правка ждёт — порядок запросов
 *  не должен перевернуться (значение формы уходит целиком). */
function createControl<V>(env: {
  key: string;
  live: Live<V>;
  /** Последние колбэки компонента — контрол читает их в момент вызова. */
  latest: { current: Latest<V> };
  delay: number;
  isAlive: () => boolean;
  setDraft: (next: V | null) => void;
  setFailed: (failed: boolean) => void;
  setFlight: (next: V | null) => void;
}): Control<V> {
  const { key, live, latest, delay } = env;
  const blocked = (value: V) => latest.current.isBlocked(value);
  const send = () => {
    const value = live.draft;
    if (!value || live.busy) return;
    live.busy = true;
    env.setFlight(value);
    latest.current.save(value).then(
      () => settle(value),
      () => fail(),
    );
  };
  const arm = () => {
    clearTimeout(live.timer);
    live.timer = undefined;
    const value = live.draft;
    if (!value || blocked(value)) return;
    live.timer = setTimeout(() => {
      live.timer = undefined;
      send();
    }, delay);
  };
  const settle = (sent: V) => {
    live.busy = false;
    if (live.draft === sent) {
      // Сохранено: черновик снят, лист показывает то же из кэша запроса
      // (мутация правит его оптимистично) — без «отскока» к прежнему виду.
      live.draft = null;
      live.edited = false;
      unsaved.delete(key);
      env.setDraft(null);
    } else if (live.draft && !blocked(live.draft)) {
      // Пока сохраняли, правили дальше: вкладку уже покинули — сразу, иначе по таймеру.
      if (env.isAlive()) arm();
      else send();
    }
    env.setFlight(null);
  };
  const fail = () => {
    live.busy = false;
    live.edited = false;
    if (live.draft) unsaved.set(key, { value: live.draft, failed: true });
    env.setFailed(true);
    env.setFlight(null);
  };
  return {
    edit: (next) => {
      live.draft = next;
      live.edited = true;
      unsaved.set(key, { value: next, failed: false });
      env.setDraft(next);
      env.setFailed(false);
      arm();
    },
    retry: () => {
      env.setFailed(false);
      if (live.draft) send();
    },
    flush: () => {
      clearTimeout(live.timer);
      live.timer = undefined;
      // Уходя, сохраняем правку этой вкладки и только годную: пустой
      // заголовок/пояснение на сервер не уходит и ждёт продолжения здесь.
      if (live.draft && live.edited && !blocked(live.draft)) send();
    },
  };
}

/**
 * Автосохранение формы сущности (единая модель «Процессов», #857): правка уходит
 * на сервер через `AUTOSAVE_DELAY_MS` после последнего изменения, без кнопок
 * «Сохранить»/«Готово»; уход с вкладки и размонтирование (смена сущности, уход
 * из раздела) сохраняют сразу. Ошибка держит черновик — `state === 'error'` и
 * «Повторить»; правка, которую нельзя отправлять (`isBlocked`: пустой
 * заголовок/пояснение — `blockEmptyDecor` окна), держит сохранение до следующей
 * правки. `saved` — форма из кэша запроса: мутация правит его оптимистично,
 * поэтому лист не «отскакивает» к прежнему виду между ответом и перечитыванием.
 *
 * Хук живёт в раме сущности (не во вкладке): таймер и запрос переживают
 * переключение вкладок, а покидание вкладки — явный `flush()`.
 */
export function useFormAutosave<X>({
  key,
  saved,
  save,
  isBlocked,
  delay = AUTOSAVE_DELAY_MS,
}: {
  /** Ключ сущности: с ним живёт несохранённый черновик. */
  key: string;
  saved: BuilderValue<X>;
  save: (next: BuilderValue<X>) => Promise<void>;
  isBlocked: (next: BuilderValue<X>) => boolean;
  delay?: number;
}): FormAutosave<X> {
  const initial = draftOf<BuilderValue<X>>(key);
  const [draft, setDraft] = useState<BuilderValue<X> | null>(initial?.value ?? null);
  const [failed, setFailed] = useState(initial?.failed ?? false);
  const [flight, setFlight] = useState<BuilderValue<X> | null>(null);
  const latest = useRef<Latest<BuilderValue<X>>>({ save, isBlocked });
  latest.current.save = save;
  latest.current.isBlocked = isBlocked;
  const live = useRef<Live<BuilderValue<X>>>({
    draft: initial?.value ?? null,
    edited: false,
    busy: false,
    timer: undefined,
  });
  const alive = useRef(true);
  const control = useRef<Control<BuilderValue<X>> | null>(null);
  if (control.current === null) {
    control.current = createControl({
      key,
      live: live.current,
      latest,
      delay,
      isAlive: () => alive.current,
      setDraft,
      setFailed,
      setFlight,
    });
  }

  useEffect(() => {
    const current = control.current;
    if (!current) return;
    alive.current = true;
    return () => {
      alive.current = false;
      current.flush();
    };
  }, []);

  const state: FormSaveState = failed
    ? 'error'
    : flight
      ? 'saving'
      : !draft
        ? 'idle'
        : isBlocked(draft)
          ? 'blocked'
          : 'waiting';
  return { ...(control.current as Control<BuilderValue<X>>), value: draft ?? saved, state };
}

/** Тихая строка состояния автосохранения — в баре рамы, слева от шестерёнки.
 *  Ступени те же, что у бара (контейнер задаёт рама): уже 800px «Сохранение…»
 *  остаётся одной иконкой — у рамы типа проекта с четырьмя вкладками там нет
 *  места для строки. */
export function FormSaveState({ state, onRetry }: { state: FormSaveState; onRetry: () => void }) {
  if (state === 'idle') return null;
  if (state === 'error') {
    return (
      <span role="alert" className="flex items-center gap-1 text-xs text-danger">
        <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {b.notSaved}
        <Button type="button" variant="ghost" size="xs" onClick={onRetry}>
          {b.retry}
        </Button>
      </span>
    );
  }
  if (state === 'blocked') return <span className="text-xs text-warning">{b.decorEmpty}</span>;
  return (
    <span
      role="status"
      className="flex items-center gap-1 text-xs text-muted-foreground"
      title={b.saving}
    >
      <LoaderCircle
        className="size-3.5 animate-spin @min-[800px]:hidden"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="sr-only @min-[800px]:not-sr-only">{b.saving}</span>
    </span>
  );
}
