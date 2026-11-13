import { Play, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { TaskDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import { useAuthStore } from '../../../shared/auth-store.js';
import { formatDate, formatMinutes } from '../../../shared/lib/format.js';
import {
  EMPTY_TIME_ENTRY,
  TimeEntryFields,
  timeEntryBody,
  type TimeEntryDraft,
} from '../../../shared/tasks/time-entry-fields.js';
import { PauseGlyph } from '../../../shared/ui/pause-glyph.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import {
  useAddTimeEntry,
  useDeleteTimeEntry,
  useRunningTimer,
  useStartTimer,
  useStopTimer,
  useTimeEntries,
} from '../api/time-api.js';
import { formatDuration } from '../../../shared/lib/minutes.js';

/** «ЧЧ:ММ:СС» идущего таймера — тикает раз в секунду только пока виден. */
export function useElapsed(startedAt: string | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return '';
  const total = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Таймер в баре действий (модель Битрикс24 «Начать учёт времени»): у
 *  сотрудника один таймер — запуск здесь останавливает идущий на другой
 *  задаче. В покое — значок + сумма «Ч:ММ» затраченного; при работе слот
 *  дорастает до живых «ЧЧ:ММ:СС», кнопка растёт ВЛЕВО от прибитого
 *  правого края бара. Ширина слота = длине текста в ch (шрифт моно —
 *  точный fit при любой длине), transition-[width] ведёт её плавно;
 *  иконки play↔pause кроссфейдятся. Старт/стоп оптимистичны — рост идёт
 *  с клика, без ожидания ответа сервера. */
export function TaskTimerButton({ task }: { task: TaskDetail }) {
  const { data: timer } = useRunningTimer();
  const start = useStartTimer(task.id);
  const stop = useStopTimer();
  const runningHere = timer?.task.id === task.id;
  const elapsed = useElapsed(runningHere ? timer?.startedAt : undefined);
  // Слой тикающих секунд при сворачивании держит последний тик: он тает
  // в кроссфейде, а не сменяется рывком на сумму в первом же кадре.
  const lastTick = useRef(elapsed);
  useEffect(() => {
    if (elapsed) lastTick.current = elapsed;
  }, [elapsed]);
  if (!task.access.canLogTime) return null;
  const busy = start.isPending || stop.isPending;
  const spent = formatMinutes(task.spentMinutes);
  const text = runningHere ? elapsed : spent;

  return (
    <button
      type="button"
      aria-busy={busy || undefined}
      onClick={() => {
        if (busy) return;
        if (runningHere) stop.mutate();
        else start.mutate();
      }}
      title={runningHere ? ui.tasks.timer.stop : ui.tasks.timer.start}
      aria-label={runningHere ? ui.tasks.timer.stop : ui.tasks.timer.start}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-transparent text-sm font-medium outline-none transition-[color,background-color,border-color,box-shadow,padding,opacity,filter] duration-200 ease-out focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30',
        runningHere
          ? 'bg-success-soft pr-3 pl-2 text-success hover:brightness-110'
          : 'px-2 text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <span className="relative block size-4 shrink-0">
        <Play
          strokeWidth={1.75}
          className={cn(
            'absolute inset-0 size-4 transition-opacity duration-200',
            runningHere && 'opacity-0',
          )}
        />
        <PauseGlyph
          className={cn(
            'absolute inset-0 size-4 transition-opacity duration-200',
            !runningHere && 'opacity-0',
          )}
        />
      </span>
      <span
        style={{ width: `${text.length}ch` }}
        className="relative overflow-hidden font-mono text-label-sm whitespace-nowrap tabular-nums transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
      >
        <span className={cn('transition-opacity duration-200', runningHere && 'opacity-0')}>
          {spent}
        </span>
        <span
          className={cn(
            'absolute top-0 left-0 transition-opacity duration-200',
            !runningHere && 'opacity-0',
          )}
        >
          {elapsed || lastTick.current || '00:00:00'}
        </span>
      </span>
    </button>
  );
}

/** Поле «Затрачено»: сумма — триггер поповера учёта времени (записи с
 *  автором, ручной ввод «1ч 30м» за сегодня/вчера, удаление своих). */
export function TaskSpentField({ task }: { task: TaskDetail }) {
  const [open, setOpen] = useState(false);
  const sum = (
    <span className="font-mono text-label-sm tabular-nums">
      {formatDuration(task.spentMinutes, ui.tasks.hoursShort, ui.tasks.minutesShort)}
    </span>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild aria-label={ui.tasks.timeTitle}>
        <button
          type="button"
          className="-mx-1 inline-flex h-6 items-center rounded-md px-1 transition-colors hover:bg-accent"
        >
          {sum}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-3">
        {open ? <TimeLog task={task} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function TimeLog({ task }: { task: TaskDetail }) {
  const meId = useAuthStore((s) => s.user?.id);
  const { data } = useTimeEntries(task.id);
  const add = useAddTimeEntry(task.id);
  const remove = useDeleteTimeEntry(task.id);
  const [draft, setDraft] = useState<TimeEntryDraft>(EMPTY_TIME_ENTRY);
  const entries = data?.items ?? [];

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = timeEntryBody(draft);
    if (!body) {
      toast.error(ui.tasks.minutesInvalid);
      return;
    }
    add.mutate(body, { onSuccess: () => setDraft(EMPTY_TIME_ENTRY) });
  }

  return (
    <div className="flex flex-col gap-3">
      <NodeLabel label={ui.tasks.timeTitle} />
      {task.access.canLogTime ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <TimeEntryFields value={draft} onChange={setDraft} autoFocus />
          <div className="flex items-center justify-end">
            <Button size="sm" type="submit" disabled={!draft.amount.trim() || add.isPending}>
              {ui.tasks.timeAdd}
            </Button>
          </div>
        </form>
      ) : null}
      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{ui.tasks.timeEmpty}</p>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              className="group/entry flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent/40"
            >
              <PersonAvatar
                name={e.user.displayName}
                avatarUrl={e.user.avatarUrl}
                className="size-5"
              />
              <span className="w-16 shrink-0 font-mono text-label-sm tabular-nums">
                {formatDuration(e.minutes, ui.tasks.hoursShort, ui.tasks.minutesShort)}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {e.comment ?? (e.method === 'timer' ? ui.tasks.timeByTimer : '')}
              </span>
              <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                {formatDate(e.date)}
              </span>
              {/* Слот действия фиксированной ширины у КАЖДОЙ строки — колонка
                  дат ровная (ревью #317). Идущий таймер не удаляется — сначала
                  стоп (сервер ответит 409): в слоте индикатор «идёт». */}
              <span className="flex size-4.5 shrink-0 items-center justify-center">
                {e.method === 'timer' && e.endedAt === null ? (
                  <span
                    role="img"
                    aria-label={ui.tasks.timerRunning}
                    title={ui.tasks.timerRunning}
                    className="text-success"
                  >
                    <Play className="size-3.5" strokeWidth={1.75} />
                  </span>
                ) : e.user.id === meId ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate(e.id)}
                    aria-label={ui.tasks.timeDelete}
                    title={ui.tasks.timeDelete}
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/entry:opacity-100 hover:text-danger focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </button>
                ) : null}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
