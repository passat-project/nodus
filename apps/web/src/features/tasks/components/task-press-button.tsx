import { useEffect, useRef, useState } from 'react';
import { UsersRound } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { PressRing } from './task-press.js';

function PressStatusContent({
  pressed,
  total,
  onOpenStatuses,
  onMouseEnter,
  onMouseLeave,
  onOpenAutoFocus,
}: {
  pressed: number;
  total: number;
  onOpenStatuses: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenAutoFocus: (event: Event) => void;
}) {
  return (
    <PopoverContent
      side="top"
      align="start"
      className="w-60 p-2"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onOpenAutoFocus={onOpenAutoFocus}
    >
      <div className="flex items-baseline justify-between px-1.5 py-1">
        <span className="text-xs text-muted-foreground">{ui.tasks.press.progressLabel}</span>
        <span className="font-mono text-sm tabular-nums">
          {pressed} / {total}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-full justify-start gap-2 px-1.5 text-sm"
        onClick={onOpenStatuses}
      >
        <UsersRound className="size-4 shrink-0" strokeWidth={1.75} />
        {ui.tasks.press.analyticsTitle}
      </Button>
    </PopoverContent>
  );
}

/**
 * Прогресс без действия нажатия: кольцо + счётчик для ответственного,
 * уже нажавшего и зрителей. Кнопка нажатия скрыта, но «Статусы участников»
 * остаются доступны до конца раунда.
 */
export function TaskPressStatus({
  pressed,
  total,
  onOpenStatuses,
}: {
  pressed: number;
  total: number;
  onOpenStatuses: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [byHover, setByHover] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const hide = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => cancelClose, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${ui.tasks.press.analyticsTitle}: ${pressed} / ${total}`}
          title={ui.tasks.press.analyticsTitle}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          onMouseEnter={() => {
            setByHover(true);
            show();
          }}
          onMouseLeave={() => {
            setByHover(false);
            hide();
          }}
          onClick={() => setByHover(false)}
        >
          <PressRing pressed={pressed} total={total} />
          <span className="font-mono text-label tabular-nums">
            {pressed}/{total}
          </span>
        </button>
      </PopoverTrigger>
      <PressStatusContent
        pressed={pressed}
        total={total}
        onOpenStatuses={() => {
          setOpen(false);
          onOpenStatuses();
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onOpenAutoFocus={(event) => {
          if (byHover) event.preventDefault();
        }}
      />
    </Popover>
  );
}

/**
 * Коллективная кнопка (#434): название нажимается, кольцо прогресса —
 * отдельная зона статусов участников. Кольцо не вложено в кнопку нажатия
 * (невалидный HTML и конфликт кликов): две соседние кнопки в одной пилюле.
 * Наведение на кольцо открывает поповер с прогрессом и входом «Статусы
 * участников»; клик по названию выполняет обычное нажатие.
 */
export function TaskPressButton({
  name,
  pressed,
  total,
  main,
  onPress,
  onOpenStatuses,
}: {
  name: string;
  pressed: number;
  total: number;
  main: boolean;
  onPress: () => void;
  onOpenStatuses: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [byHover, setByHover] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const hide = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => cancelClose, []);

  const tone = main
    ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
    : 'text-muted-foreground hover:bg-accent hover:text-foreground';

  return (
    <div
      role="group"
      aria-label={name}
      className={cn(
        'inline-flex h-8 shrink-0 items-stretch overflow-hidden rounded-md text-sm font-medium transition-colors',
        tone,
      )}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) setByHover(false);
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${ui.tasks.press.analyticsTitle}: ${pressed} / ${total}`}
            title={ui.tasks.press.analyticsTitle}
            className="flex shrink-0 items-center rounded-l-md pr-1 pl-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            onMouseEnter={() => {
              setByHover(true);
              show();
            }}
            onMouseLeave={() => {
              setByHover(false);
              hide();
            }}
            onClick={() => {
              setByHover(false);
            }}
          >
            <PressRing pressed={pressed} total={total} />
          </button>
        </PopoverTrigger>
        <PressStatusContent
          pressed={pressed}
          total={total}
          onOpenStatuses={() => {
            setOpen(false);
            onOpenStatuses();
          }}
          onMouseEnter={show}
          onMouseLeave={hide}
          onOpenAutoFocus={(event) => {
            if (byHover) event.preventDefault();
          }}
        />
      </Popover>
      <button
        type="button"
        aria-label={name}
        title={name}
        onClick={onPress}
        className="flex min-w-0 items-center gap-2 rounded-r-md pr-3 pl-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <span
          className={cn(
            'max-w-36 min-w-0 truncate @max-[420px]:max-w-24',
            !main && '@max-[420px]:hidden',
          )}
        >
          {name}
        </span>
        <span className="font-mono text-label tabular-nums">
          {pressed}/{total}
        </span>
      </button>
    </div>
  );
}
