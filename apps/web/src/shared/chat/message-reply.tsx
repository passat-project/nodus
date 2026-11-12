import { createContext, useContext, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Ярлык «Ответить» на пузыре по наведению (#729, референс Telegram):
 * ВТОРАЯ ТОЧКА ВХОДА того же действия, что пункт «Ответить» ПКМ-меню.
 * Логики здесь нет: хост-меню (`MessageMenu`) строит реестр пунктов и кладёт
 * готовое ДЕЙСТВИЕ в контекст — подпись (одно слово из реестра) и `run`,
 * который исполняет пункт через тот же `runMenuItem`, что и клик в меню (флаги
 * `disabled`/`closeFirst` живут в одном месте и не разойдутся). Поэтому цитата
 * не дублируется: режим `replyMode` остаётся решением меню, а отсутствие
 * пункта (режим мультивыбора, окно-источник «Избранного») убирает ярлык
 * само. В каналах ярлыка нет вовсе (вердикт админа 12.11.2026): там ответ
 * живёт в тредах, а полоса «Обсудить» уже раскрывает ту же панель — вторая
 * точка входа дублировала бы её (`MessageMenu` не отдаёт действие при
 * `replyMode='thread'`, карточка поста ярлык не рендерит, `ThreadPane` гасит
 * его флагом `hideReplyButton`).
 *
 * Видимость — `group-hover/bubble` + `focus-visible` (канон
 * new-screen-checklist: действие, живущее только по ховеру, обязано
 * открываться фокусом — WCAG 2.1.1). Ярлык — часть DOM пузыря
 * (`group/bubble`), поэтому курсор, ушедший с пузыря на ярлык, ховер не
 * рвёт; невидимый ярлык не перехватывает клики (`pointer-events-none`).
 * Движение — только `opacity`, `motion-reduce` его снимает.
 */

/** Действие ярлыка: то же, что пункт меню, уже связанное с `runMenuItem`. */
export interface MessageReplyAction {
  label: string;
  run: () => void;
}

const ReplyActionContext = createContext<MessageReplyAction | null>(null);

export function MessageReplyProvider({
  action,
  children,
}: {
  action: MessageReplyAction | null;
  children: ReactNode;
}) {
  return <ReplyActionContext.Provider value={action}>{children}</ReplyActionContext.Provider>;
}

/**
 * Плашка-«язычок» «Ответить» на верхней кромке ЧУЖОГО пузыря — финальный вид
 * по кадру владельца (13.11.2026): не выступает за кромку, «налезает» на неё
 * половиной высоты, цвет — ровно пузырь.
 *
 * **Только чужие сообщения** (вердикт владельца 13.11.2026: «ты же не можешь
 * отвечать на свои»): у своих (`mine`) язычка нет ни в одном хосте —
 * мессенджер, чат задачи, чат письма.
 *
 * Геометрия: правый край язычка отстоит от правого края пузыря на 6px
 * (`right-1.5`) — внутри границ пузыря, без выступа. Вертикально язычок
 * straddles кромку: высота 14px, сдвиг `-top-[7px]` — 7px над линией и 7px под
 * ней, «язычок на контуре», а не плашка над пузырём. Нижняя половина лежит в
 * верхнем паддинге пузыря (10px) — текст сообщения не задевается, а мостик
 * ховера жив: курсор с тела пузыря на язычок не покидает `group/bubble`.
 *
 * Цвет: фон — РОВНО заливка входящего пузыря (`bg-bubble-in`, без микс-ступени,
 * как просил владелец), текст — цвет текста пузыря
 * (`text-bubble-in-foreground`), а не приглушённый: язычок читается тем же
 * тоном, что и само сообщение. **При наведении цвет не меняется вовсе**
 * (вердикт владельца 13.11.2026 по живой проверке) — hover-цветов у плашки нет,
 * остаётся только `cursor: pointer`; клавиатурный фокус виден рингом
 * (`focus-visible`). Скругление небольшое (`rounded-md`), без рамки и тени.
 *
 * Ширина — по тексту (`whitespace-nowrap`), паддинги `px-2` (по 8px), чтобы
 * буквы не липли к краям; на узком пузыре `max-w-full` + `truncate` —
 * язычок не шире пузыря, подпись усекается многоточием, выезда за кромку нет.
 *
 * Фолбэка по замеру нет: выступов нет, язычок всегда внутри пузыря, а пузырь
 * не шире 80% ленты (`max-w-[min(80%,40rem)]`).
 */
export function MessageReplyButton({ mine }: { mine: boolean }) {
  const action = useContext(ReplyActionContext);
  // Нет действия — нет ярлыка: селект, летящий темп, канал и окно-источник
  // отсекает реестр меню (ярлык ничего не решает сам). Своё сообщение — тоже
  // без ярлыка: отвечать на себя нечего.
  if (!action || mine) return null;

  return (
    <span
      data-slot="message-reply-slot"
      className={cn(
        // Кромка пузыря: бокс прижат к правому краю (6px внутрь) и straddles её
        // половиной высоты (-top-[7px]) — мостик жив, курсор с тела пузыря на
        // язычок не рвёт group-hover. В покое клики проходят насквозь.
        'pointer-events-none absolute -top-[7px] right-1.5 z-20 flex max-w-full group-hover/bubble:pointer-events-auto',
      )}
    >
      <button
        type="button"
        // Подпись видна — доступное имя даёт полную фразу из i18n (тултипа нет:
        // слово и так на экране).
        aria-label={ui.chat.replyToMessage}
        onClick={action.run}
        // «Вечный курсор» (канон #71): клик по ярлыку не уводит каретку из
        // композера — фокус в поле не нужен, ответ ставит само действие.
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          // Фон — ровно заливка пузыря, текст — цвет текста пузыря: язычок
          // выглядит продолжением сообщения. НИКАКИХ hover-цветов (вердикт
          // владельца 13.11.2026: при наведении цвет не меняется) — только
          // cursor: pointer; клавиатурный фокус виден рингом. Ширина по тексту,
          // на узком пузыре — max-w-full с усечением и паддингами px-2.
          'pointer-events-none max-w-full cursor-pointer truncate rounded-md bg-bubble-in px-2 py-px text-xs leading-none whitespace-nowrap text-bubble-in-foreground',
          'opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
          'group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100',
          'focus-visible:pointer-events-auto focus-visible:ring-1 focus-visible:ring-ring/30 focus-visible:opacity-100 focus-visible:outline-none',
        )}
      >
        {action.label}
      </button>
    </span>
  );
}
