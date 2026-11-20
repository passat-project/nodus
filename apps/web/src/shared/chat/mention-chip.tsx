import type { CSSProperties, ReactNode } from 'react';

import { parseMentionSegments } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { personTone, personToneVar } from '../ui/person-tone.js';
import { openEmployeeCardFromChat } from './employee-card-nav.js';

/**
 * Чип @упоминания (#176, модель Slack): inline-токен `@[текст](user:id)`
 * рендерится пилюлей персонального цвета упомянутого (#180 — тон
 * идентичности человека; палитра --name-1..7 текстопригодна на пузырях
 * обеих тем). Клик в ленте — карточка сотрудника (с #972 — вкладкой
 * «Задачи»); токен из текста убирается парсером (contracts), чип — его
 * визуальная замена.
 *
 * Контраст по поверхности (#224, ревизия приёмки): персональный тон на
 * СВОЁМ цветном пузыре давал «синее на синем». На пузыре variant=default
 * (своё сообщение) чип переключается на цвет текста пузыря с полупрозрачной
 * заливкой этого же цвета (канон Telegram: весь текст своего пузыря —
 * единый цвет). Селекторы group-data специфичнее базового класса тинта —
 * перекрытие надёжно без !important.
 */

/** Тинт пилюли — CSS-переменной (класс ниже): инлайн background блокировал
 *  бы вариантное перекрытие своего пузыря (inline > любой селектор).
 *  «Все» — НЕ человек: нейтральный тон переднего плана (тон = маркер
 *  идентичности, у «Все» идентичности нет). */
function chipStyle(userId: string): CSSProperties {
  const tone = userId === 'all' ? 'var(--foreground)' : personToneVar(userId);
  return {
    '--mention-tint': `color-mix(in oklch, ${tone} 12%, transparent)`,
  } as CSSProperties;
}

/** Тон текста чипа: персональный; «Все» — цвет текста хоста. */
function chipToneClass(userId: string): string {
  return userId === 'all' ? 'text-foreground' : personTone(userId);
}

/** Общий каркас пилюли: поля px-1.5 (ревизия #224 — Material input-chip,
 *  ~6px горизонтального поля; прежние px-1 выглядели «впритык»). */
const CHIP_BASE =
  'mx-0.5 inline-flex max-w-full items-baseline truncate rounded-md px-1.5 align-baseline';

/** Своё сообщение (пузырь variant=default): цвет текста пузыря вместо
 *  персонального тона — иначе тон-на-тон не читается (ревизия #224). */
const CHIP_ON_OWN =
  'group-data-[variant=default]/bubble:text-bubble-out-foreground group-data-[variant=default]/bubble:bg-[color-mix(in_oklch,var(--bubble-out-foreground)_16%,transparent)]';

/** Чип в ленте: кнопка-ссылка на карточку сотрудника. Токен чипа не
 *  разрывается переносом строки (nowrap-поведение inline-flex + truncate
 *  длинных ФИО на узких панелях). */
export function MentionChip({ id, label }: { id: string; label: string }) {
  return (
    <button
      type="button"
      data-slot="mention-chip"
      onClick={(e) => {
        e.stopPropagation();
        if (id !== 'all') openEmployeeCardFromChat(id);
      }}
      style={chipStyle(id)}
      className={cn(
        CHIP_BASE,
        'bg-[var(--mention-tint)] font-medium transition-[filter] hover:brightness-110',
        CHIP_ON_OWN,
        chipToneClass(id),
      )}
    >
      {label || '@'}
    </button>
  );
}

/** Чип сниппетов (цитата-ответ, панель поиска, «Избранное», закреп,
 *  уведомления #224): без интерактива — строка-хост сама кликабельна
 *  (прыжок), вложенная кнопка ломала бы её семантику; тон и пилюля — те
 *  же, размер наследует хост. На цветных пузырях (цитата своего
 *  сообщения) перекрывается как интерактивный чип. */
export function MentionChipMuted({ id, label }: { id: string; label: string }) {
  return (
    <span
      data-slot="mention-chip"
      style={chipStyle(id)}
      className={cn(
        'inline-flex max-w-full truncate rounded-md px-1.5 font-medium',
        'bg-[var(--mention-tint)]',
        CHIP_ON_OWN,
        chipToneClass(id),
      )}
    >
      {label || '@'}
    </span>
  );
}

/** Текст сниппета сегментами (пассивные чипы): общий хелпер однострочных
 *  preview — цитаты, строки выдачи, закреп, уведомления; пустой label → «@». */
export function mentionSnippetNodes(text: string): ReactNode[] {
  return parseMentionSegments(text).map((segment, i) =>
    segment.kind === 'mention' ? (
      <MentionChipMuted key={i} id={segment.id} label={segment.label} />
    ) : (
      <span key={i}>{segment.value}</span>
    ),
  );
}

/** Сниппет с чипами упоминаний: без токенов — сырой текст (DOM хоста не
 *  меняется), с токенами — пассивные чипы. */
export function MentionSnippet({ text }: { text: string }) {
  if (!text.includes('@[')) return <>{text}</>;
  return <>{mentionSnippetNodes(text)}</>;
}
