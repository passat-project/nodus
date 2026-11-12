import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { PersonalStageCreateBody, StageColor } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { cn } from '@nodus/ui/lib/utils';

import { BOARD_COLUMN_CLASS } from '../../../shared/ui/board/board-metrics.js';
import { stageColorOrder, stageTone } from '../../../shared/ui/board/stage-tone.js';

/**
 * Контур плитки «Добавить стадию» — outline со смещением ВНУТРЬ, а не border:
 * отступы и пунктир живут внутренним блоком, сама плитка несёт только общий
 * `BOARD_COLUMN_CLASS` с полосой ширины 240–360px (#824) — контур не участвует
 * в раскладке и не отнимает ширину у содержимого. История (#730): при
 * flex-basis border+padding добавлялись сверх доли, и плитка выходила на 22px
 * шире колонки (замер владельца на :4173: колонки 241px, плитка 263px).
 */
const TILE_FRAME_CLASS = 'rounded-lg outline-1 outline-dashed outline-border outline-offset-[-1px]';

/** Иконка-кнопка плитки (создать/отмена): кольцо фокуса по канону, таб-порядок
 *  «поле → создать → отмена → палитра». */
const TILE_ICON_BUTTON_CLASS =
  'flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40';

/** Создание личной колонки «Моего плана» — ПЛИТКА доски, а не пилюля
 *  (уточнение владельца 10.11.2026): та же ширина и высота, что у колонок
 *  стадий (`BOARD_COLUMN_CLASS` — полоса 240–360px, #824), пунктирный контур,
 *  содержимое по центру ВНУТРЕННИМ блоком (плитка сама не несёт
 *  padding/border). Она занимает шестое место в ряду — поэтому на опорном
 *  Full HD при 5 стадиях ряд заполнен ровно (6 плиток), а при 6+ включается
 *  edge-scroll (#366).
 *  В раскрытом виде — та же плитка: строка «цвет + название + ✓ + ✕»
 *  (Enter — создать, Esc/пустое поле — отмена; кнопки делают то же мышью) и
 *  палитра цветов. Создание закрывает плитку только после ответа сервера:
 *  при ошибке ввод остаётся, тост показывает хук мутации. */
export function TaskStageCreate({
  onCreate,
  creating,
}: {
  onCreate: (body: PersonalStageCreateBody) => Promise<unknown> | void;
  creating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<StageColor>('neutral');
  const ready = name.trim().length > 0 && !creating;

  function reset() {
    setOpen(false);
    setName('');
    setColor('neutral');
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    try {
      await onCreate({ name: trimmed, color, systemState: 'active' });
      reset();
    } catch {
      // Отказ сервера: тост уже показан хуком мутации, форму и ввод не теряем.
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ui.tasks.addStage}
        className={cn(
          BOARD_COLUMN_CLASS,
          'flex h-full flex-col text-label-sm font-medium text-muted-foreground transition-colors',
          TILE_FRAME_CLASS,
          'hover:bg-accent/20 hover:text-foreground hover:outline-port/50 focus-visible:outline-2 focus-visible:outline-ring',
        )}
      >
        <span className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center gap-1 p-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border">
            <Plus className="size-4" strokeWidth={1.75} />
          </span>
          <span className="max-w-full min-w-0 truncate text-center">{ui.tasks.addStage}</span>
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        BOARD_COLUMN_CLASS,
        'flex h-full flex-col bg-card text-label-sm',
        TILE_FRAME_CLASS,
      )}
    >
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 p-2">
        {/* Строка «название + создать + отмена»: поле сжимается
            (min-w-0 flex-1), кнопки не прячутся даже в узкой плитке (~138px).
            Кружок текущего цвета живёт в палитре ниже (выбранный — с кольцом):
            в строке поля он съедал 25px, которых на 1280 и так нет. */}
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') reset();
            }}
            onBlur={() => {
              if (!name.trim()) reset();
            }}
            placeholder={ui.tasks.stageNamePlaceholder}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready}
            aria-label={ui.tasks.createStage}
            title={ui.tasks.createStage}
            className={TILE_ICON_BUTTON_CLASS}
          >
            <Check className="size-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={reset}
            aria-label={ui.common.cancel}
            title={ui.common.cancel}
            className={TILE_ICON_BUTTON_CLASS}
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
        {/* Палитра переносится по строкам: плитка узкая (1/6 ряда) — десять
            цветов в одну строку не влезают. */}
        <div className="flex flex-wrap gap-1.5">
          {stageColorOrder.map((c) => (
            <button
              key={c}
              type="button"
              title={ui.tasks.stageColors[c]}
              aria-label={ui.tasks.stageColors[c]}
              onClick={() => setColor(c)}
              className={cn(
                'size-3.5 rounded-full transition-shadow',
                stageTone[c].swatch,
                color === c
                  ? 'ring-2 ring-ring ring-offset-1 ring-offset-card'
                  : 'opacity-50 hover:opacity-100',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
