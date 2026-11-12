import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { useReactionToggle } from './reaction-mutations.js';
import { ReactionGlyph } from './reaction-glyph.js';
import { REACTION_BASE, REACTION_MORE, REACTION_QUICK } from './reaction-presets.js';

/** Задержка закрытия при уходе курсора с пилюли/панели (hover-intent).
 *  Эталон — NN/g (timing exposing content): намерение свернуть контент,
 *  показанный по наведению, определяется только когда курсор отсутствует
 *  дольше 0.5 с. Прежние 180 мс «съедали» панель при промахе на переезде
 *  с пилюли на панель (#821). Возврат курсора отменяет закрытие. */
const CLOSE_GRACE_MS = 500;

/** Открытие нового попапа закрывает предыдущий — панели не висят рядом (#132). */
let closeActivePanel: (() => void) | null = null;

/**
 * Ховер-пилюля реакций (#124 → #132, вердикты владельца 28.09 + раунды 2–5):
 * при наведении на ПУЗЫРЬ (group-hover/bubble — не на строку ленты) в его
 * нижнем углу появляется САМА БАЗОВАЯ реакция (REACTION_BASE, анимированный
 * глиф) — клик сразу ставит/снимает её, без промежуточной панели; по ховеру
 * пилюля УВЕЛИЧИВАЕТСЯ (базовый размер 20px → hover 28px, раунд 5: прежний
 * базовый 28px стал hover-результатом scale-[1.4], модель Битрикс24 —
 * проще попасть). Панель со всеми реакциями открывается НАВЕДЕНИЕМ на
 * пилюлю: по умолчанию ВНИЗ по стрелочке шеврона, ВВЕРХ — только когда
 * снизу не влезает раскрытая панель (нижние сообщения; сторона фиксируется
 * при открытии — телепорт исключён, см. choosePanelSide). Курсор ушёл
 * (grace 500мс — промах не «съедает» панель, #821) — панель закрыта, В ТОМ
 * ЧИСЛЕ сброс раскрытия сетки: таймер раньше звал setOpen напрямую мимо
 * onOpenChange, где жил единственный сброс expanded — раскрытие «залипало»
 * до Esc (#132).
 */
/** Оценка высоты раскрытой сетки: 5 рядов size-10 + p-1 + бордер. */
const GRID_HEIGHT_PX = 5 * 40 + 10;

export function ReactionPicker({
  message,
  atEnd,
  quickItems,
  moreItems,
  baseEmoji,
  isActive,
  onPick,
  ariaLabel,
}: {
  /** Публичные реакции: сообщение-хозяин (с layer-пропами НЕ передаётся). */
  message?: ChatMessage;
  atEnd: boolean;
  /** Слой личных тэгов (#171 р.5): свои наборы/база/активность/выбор. */
  quickItems?: string[];
  moreItems?: string[];
  baseEmoji?: string;
  isActive?: (emoji: string) => boolean;
  onPick?: (emoji: string) => void;
  ariaLabel?: string;
}) {
  const toggle = useReactionToggle(message?.conversationId ?? '');
  const QUICK = quickItems ?? REACTION_QUICK;
  const MORE = moreItems ?? REACTION_MORE;
  const BASE = baseEmoji ?? REACTION_BASE;
  const label = ariaLabel ?? ui.chat.addReaction;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [gridUp, setGridUp] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closePanel = useCallback(() => {
    cancelClose();
    setOpen(false);
    setExpanded(false);
  }, [cancelClose]);

  useEffect(
    () => () => {
      if (closeActivePanel === closePanel) closeActivePanel = null;
    },
    [closePanel],
  );

  // Летящий темп (seq=0, id=tempId): реакция — серверная команда, сервер
  // не знает tempId (#243, канон Telegram: с неотправленным ничего нельзя).
  if (message?.seq === 0) return null;

  function scheduleClose() {
    cancelClose();
    closeTimer.current = window.setTimeout(closePanel, CLOSE_GRACE_MS);
  }

  function openPanel() {
    if (closeActivePanel && closeActivePanel !== closePanel) closeActivePanel();
    closeActivePanel = closePanel;
    cancelClose();
    setOpen(true);
  }

  function mineOf(emoji: string): boolean {
    if (message) {
      return message.reactions.find((reaction) => reaction.emoji === emoji)?.mine ?? false;
    }
    return isActive?.(emoji) ?? false;
  }

  function pick(emoji: string) {
    if (message) {
      toggle.mutate({ messageId: message.id, emoji, remove: mineOf(emoji) });
      return;
    }
    onPick?.(emoji);
  }

  /** Направление раскрытия сетки: ВНИЗ по шеврону (накрывает пилюлю и ленту
   *  ниже); ВВЕРХ — только когда снизу не влезает высота сетки (раунд 4). */
  function toggleExpanded() {
    if (!expanded) {
      const rect = panelRef.current?.getBoundingClientRect();
      const spaceBelow = rect ? window.innerHeight - rect.bottom : 0;
      setGridUp(spaceBelow < GRID_HEIGHT_PX + 8);
    }
    setExpanded((value) => !value);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Esc/внешний клик закрывают сразу; уход курсора — через scheduleClose.
        if (next) {
          setOpen(true);
        } else {
          closePanel();
        }
      }}
    >
      {/* Якорь панели — СТАБИЛЬНАЯ обёртка фиксированного размера (20px,
          раунд 5): hover-рост пилюли — transform ВНУТРИ обёртки (scale 1.4
          → 28px), rect якоря не меняется, панель не дёргается (раунд 3).
          Выступ вправо >половины, вниз <половины (12/8 от 20px). Клики/hover
          вешаем на обёртку. */}
      <PopoverAnchor asChild>
        <span
          data-slot="reaction-picker-trigger"
          onMouseEnter={openPanel}
          onMouseLeave={scheduleClose}
          className={cn(
            'absolute -bottom-2 z-10 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/bubble:opacity-100',
            // Пилюля видна, пока открыта панель (под ней, не перекрыта).
            open && 'opacity-100',
            atEnd ? '-left-3' : '-right-3',
          )}
        >
          <button
            type="button"
            aria-label={label}
            aria-pressed={mineOf(BASE)}
            title={label}
            onClick={() => pick(BASE)}
            // «Вечный курсор» (канон #71): клик по пилюле не уводит фокус
            // из композера — каретка мигает всегда.
            onMouseDown={(event) => event.preventDefault()}
            className="flex size-5 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-transform duration-150 hover:scale-[1.4] hover:border-foreground/30 hover:text-foreground"
          >
            {/* Глиф меньше кружка (вердикт р.5: «почти вылазит за границы»):
                анимированный Noto — высокий, 16px в 18px внутреннего поля
                касались краёв; 14px дают видимый воздух. Панель НЕ тронута. */}
            <ReactionGlyph emoji={BASE} className="size-3.5" />
          </button>
        </span>
      </PopoverAnchor>
      {/* Раунды 3–4 (вердикты): панель (быстрый ряд) ВСЕГДА сверху
          дефолтной пилюли, с ЯВНЫМ ЗАЗОРОМ (sideOffset 8, как в Битрикс24);
          сетка раскрытия — ВНЕ ПОТОКА (absolute): быстрый ряд стоит на месте,
          сетка едет ВНИЗ по стрелочке шеврона (накрывая пилюлю и ленту ниже),
          ВВЕРХ — только когда снизу не влезает; высота панели не меняется —
          Radix ничего не репозиционирует, дёрганья исключены. */}
      <PopoverContent
        ref={panelRef}
        side="top"
        align={atEnd ? 'end' : 'start'}
        sideOffset={8}
        data-slot="reaction-pop"
        // «Вечный курсор» (канон #71, как media-picker #130/#132): панель
        // открывается ХОВЕРОМ — автофокус контента уводил каретку из
        // композера, а stealFocus молчал по гварду insideOverlayLayer
        // (role=dialog); при закрытии фокус падал в body. Фокус отсюда
        // вообще не должен уходить в панель.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        className="relative w-auto p-1"
      >
        <div className="flex items-center gap-0">
          {QUICK.map((emoji) => (
            <EmojiButton key={emoji} emoji={emoji} active={mineOf(emoji)} onPick={pick} />
          ))}
          <button
            type="button"
            aria-label={ui.chat.moreReactions}
            aria-expanded={expanded}
            title={ui.chat.moreReactions}
            onClick={toggleExpanded}
            // «Вечный курсор» (#71): кнопки панели не фокусируются мышью.
            onMouseDown={(event) => event.preventDefault()}
            className="flex size-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform duration-200', expanded && 'rotate-180')}
              strokeWidth={1.75}
            />
          </button>
        </div>
        {/* Раскрытие — grid-rows 0fr→1fr выездом из-под быстрого ряда. */}
        <div
          className={cn(
            'absolute inset-x-0 grid transition-[grid-template-rows] duration-200 ease-out',
            gridUp ? 'bottom-full mb-1' : 'top-full mt-1',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="overflow-hidden">
            <div
              className={cn(
                'grid grid-cols-6 gap-0 border-border bg-card p-1 shadow-md',
                gridUp ? 'rounded-xl border-b' : 'rounded-xl border-t',
              )}
            >
              {MORE.map((emoji) => (
                <EmojiButton key={emoji} emoji={emoji} active={mineOf(emoji)} onPick={pick} />
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Эмодзи выбора (#132 р.2: прежний размер возвращён — 40px кнопка / 24px
 *  глиф; зазоры между стикерами убраны в ноль — плотность как в Телеграме). */
function EmojiButton({
  emoji,
  active,
  onPick,
}: {
  emoji: string;
  active: boolean;
  onPick: (emoji: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={emoji}
      onClick={() => onPick(emoji)}
      // «Вечный курсор» (#71): клик по эмодзи не уводит фокус из композера.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        'flex size-10 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110 hover:bg-accent',
        active && 'bg-info-soft/60 hover:bg-info-soft/60',
      )}
    >
      <ReactionGlyph emoji={emoji} className="size-6" />
    </button>
  );
}
