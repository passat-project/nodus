import { useState } from 'react';
import { Check, Settings } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import type { VideoPlayer } from './use-video-player.js';

/** Пресеты скорости — как в меню плеера Telegram/YouTube. */
const SPEEDS = [
  { rate: 0.5, label: ui.files.speedSlow },
  { rate: 1, label: ui.files.speedDefault },
  { rate: 1.2, label: ui.files.speedFast },
  { rate: 1.5, label: ui.files.speedFaster },
  { rate: 1.7, label: ui.files.speedVeryFast },
  { rate: 2, label: ui.files.speedMax },
] as const;

/** 1 → «1.0x», 2 → «2x», 1.2 → «1.2x» — как в меню Telegram. */
export function formatSpeed(rate: number): string {
  return `${Number.isInteger(rate) && rate !== 1 ? rate : rate.toFixed(1)}x`;
}

/**
 * Скорость воспроизведения в меню-поповере (26.11.2026, «как в Telegram»):
 * шестерёнка в нижней панели зала открывает список пресетов и ползунок
 * 0.5–2×. Скорость живёт в `useVideoPlayer` (`ratechange`), поэтому ползунок
 * и список — два вида одного значения. Поповер портальный: z-90 выше зала
 * z-80, иначе меню уходило бы под затемнение.
 */
export function VideoSpeedMenu({
  player,
  triggerClassName,
  onOpenChange,
}: {
  player: VideoPlayer;
  triggerClassName?: string;
  /** Открытие меню держит панель зала видимой: таймер автоскрытия ждёт. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const current = formatSpeed(player.rate);

  return (
    <Popover open={open} onOpenChange={setOpenState}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={triggerClassName}
          aria-label={ui.files.playbackSpeed}
          title={ui.files.playbackSpeed}
        >
          <Settings />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        className="z-[90] w-56 rounded-xl border border-neutral-700 bg-neutral-800 p-0 text-neutral-200 shadow-none ring-0"
      >
        <div className="p-3">
          <div className="flex items-center gap-3">
            <span className="w-10 shrink-0 font-mono text-sm tabular-nums">{current}</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={player.rate}
              onChange={(event) => player.changeRate(Number(event.target.value))}
              aria-label={ui.files.playbackSpeed}
              aria-valuetext={current}
              className="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
            />
          </div>
          <div className="my-2 h-px bg-white/10" />
          <div className="flex flex-col gap-0.5">
            {SPEEDS.map(({ rate, label }) => {
              const selected = Math.abs(player.rate - rate) < 0.001;
              return (
                <button
                  key={rate}
                  type="button"
                  onClick={() => {
                    player.changeRate(rate);
                    setOpenState(false);
                  }}
                  aria-pressed={selected}
                  className={cn(
                    'flex h-8 w-full items-center gap-3 rounded-lg px-2 text-left text-sm transition-colors',
                    selected ? 'text-primary' : 'text-neutral-200 hover:bg-white/5',
                  )}
                >
                  <span className="w-10 shrink-0 font-mono text-xs tabular-nums">
                    {formatSpeed(rate)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {selected ? <Check className="size-4 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
