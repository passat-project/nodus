// >300 строк — обоснование (I5): единственная геометрия карточек продукта
// (ADR-0009) — один компонент с неразрывной хореографией раскрытия и
// закрытия (FLIP из источника, фазы гашения контента и схлопывания, сигнал
// cardClosing нижним карточкам), стеком Esc и фокус-трапом: всё это делит
// panelRef/closingRef/sourceRect одного монтирования. Около половины объёма —
// документация пропсов и канон-комментарии вердиктов владельца; публичное API
// для фич (patterns.md) — этот файл, разнос дробил бы разрешённый путь.
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { inputModality } from '../../shared/lib/input-modality.js';
import { hasOpenPopperLayer } from '../../shared/lib/overlay-layers.js';
import { SurfaceVisibilityProvider } from '../../shared/lib/surface-visibility.js';
import { shellPanelHeight } from '../../shared/desktop/desktop-bridge.js';
import { CardHeaderActionsContext } from './card-header-actions.js';
import { useRailHidden } from './rail-visibility.js';
import { EDGE_W_COLLAPSED } from './right-rail.js';
import { uiPx } from '../../shared/ui/ui-scale.js';
import { useShellStore } from './shell-store.js';

/** Стек слайдеров: ESC закрывает только верхнюю панель (§10.2). */
const stack: string[] = [];

/** Rect источника в координатах вьюпорта: строка списка, карточка канбана,
 *  карточка ленты — из getBoundingClientRect на клике. */
export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CLOSE_MS = 200;
const CLOSE_EASE = 'cubic-bezier(0.5, 0, 0.9, 0.4)';
/** Фаза 1 закрытия: контент гаснет за 100 мс, и ТОЛЬКО потом (фаза 2)
 *  оболочка схлопывается в источник (delay в анимации). Мгновенное скрытие
 *  контента одним кадром давало «вспышку на весь экран», а схлопывание с
 *  живым текстом — «отпечаток» текста поверх страницы (баг-вердикты
 *  владельца 15.09.2026). */
const CONTENT_FADE_MS = 100;

/**
 * Детальная панель — общий слой карточки-сущности и ЕДИНСТВЕННАЯ геометрия
 * карточек продукта (ADR-0009, вердикт владельца 2026-09-10): все сущности
 * (задача, проект, письмо, сотрудник) открываются панелью ОДНОГО размера
 * (зазоры периметра 8css внутри хоста: парящий лист со скруглением всех
 * углов, пакет мягкости, вердикт владельца 12.09.2026: «карточка не до
 * самого верха»; в оболочке верх — ПОД строкой панели безрамочного окна
 * (ADR-0055) с тем же зазором — вкладки/⟳/адрес живы при открытой карточке,
 * вердикт владельца 25.11 #1038; правый край хоста = левый край служебной
 * полосы — карточка
 * НЕ накрывает полосу и сужается вместе с мягкой рамой при её раскрытии,
 * план R4) и НАСЛАИВАЮТСЯ друг на друга
 * стеком (хост —
 * CardStackHost, стек в `?cards=`): закрытие верхней возвращает к прежней,
 * смонтированной под ней, — без дёргания геометрии и потери места.
 * Уровней/смещений НЕТ (уровневые inset'ы ломали единство размеров).
 *
 * Открытие — shared-element расширение (FLIP): панель стартует точным rect'ом
 * источника (строка/карточка, по которой кликнули) и за 430 мс доезжает до
 * своей геометрии — связь «кликнул здесь → открылось это» читается без линий
 * поверх контента; контент проявляется с задержкой 160 мс. Без источника
 * (прямая ссылка, палитра, восстановление стека из URL) — сдержанный
 * scale-fade из центра. Закрытие — обратное схлопывание в источник за
 * CLOSE_MS.
 *
 * Хореография (канон, см. nodus-ui-style/references/circuit.md):
 * — анимация строго transform/opacity (композитор): не зависит от занятости
 *   main thread, первое открытие равно повторным;
 * — тяжёлый контент (children) монтируется ПОСЛЕ первого отрисованного кадра
 *   (double rAF): маунт дерева карточки не блокирует старт раскрытия;
 * — затемняющего задника НЕТ (фон страницы цвета не меняет, референс —
 *   слайдер Битрикс24): модальность дают тень slider-shadow и прозрачный
 *   click-catcher (клик мимо панели закрывает её).
 */
export function SliderPanel({
  title,
  headerContent,
  headerActions,
  cardTopbar = false,
  fullscreen = false,
  dormant = false,
  onClose,
  sourceRect,
  fadeContent = true,
  children,
}: {
  /** Главное название сущности — в хроме слайдера, на видном месте (вердикт
   *  владельца: не внутри карточки, где сливается с описанием). Крошек нет.
   *  ReactNode — чтобы нести маркер-идентичность сущности рядом с именем. */
  title?: ReactNode;
  /** Замена заголовка в хроме (полноэкранная карточка мессенджера: вкладки
   *  Чаты/Чаты задач/Настройка с портами `data-tab-port` вместо названия). */
  headerContent?: ReactNode;
  /** Действия шапки справа (правка/меню/раскладка) — ReactNode для прямых
   *  потребителей; карточки используют `CardHeaderActionsPortal`. */
  headerActions?: ReactNode;
  /** true — хедер помечается `data-card-topbar`: контур измеряет его вместо
   *  топбара шелла (режим карточки, план messenger-fullscreen). */
  cardTopbar?: boolean;
  /** true — ПОЛНОЭКРАННАЯ геометрия (карточка мессенджера, план
   *  messenger-fullscreen): правый край = край периметра (stripW=0) независимо
   *  от полосы. Полоса при этом НЕ скрывается шеллом — карточка накрывает её
   *  сама, и карточки ПОД ней не меняют геометрию (баг-вердикт владельца
   *  15.09.2026: расширение нижней карточки во время раскрытия верхней). */
  fullscreen?: boolean;
  /** true — карточка СПИТ под верхними карточками стека (issue #63):
   *  content-visibility:hidden на хосте — потомки пропускаются рендерингом
   *  (layout/paint/style), состояние сохраняется (MDN: rendering state
   *  preserved — скролл, вкладки, черновики целы), сам хост (fixed, insets)
   *  продолжает дёшево следовать за полосой. Снимается по cardClosing —
   *  окно гашения контента (CONTENT_FADE_MS) до схлопывания верхней
   *  покрывает раскладку этой карточки до её проявления. Бонус a11y:
   *  накрытые карточки выпадают из tab-order и find-in-page (MDN: skipped
   *  contents not focusable). */
  dormant?: boolean;
  onClose: () => void;
  sourceRect?: SourceRect;
  /** false — карточка сама управляет проявлением: её зональные фоны (тёмный
   * чат) рендерятся структурой с первого кадра роста, content-fade получают
   * только текст/контролы зон. Иначе фон зоны появляется вместе с контентом и
   * читается как смена цвета в середине раскрытия (вердикт владельца). */
  fadeContent?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  // Промоушен слоя — ТОЛЬКО на время FLIP-раскрытия (#969): постоянный
  // `will-change: transform` оставлял содержимое карточки растром масштаба
  // источника, и зона «мылилась» до первой paint-инвалидации. Снимается по
  // animationend раскрытия; на закрытии ставится снова перед WAAPI.
  const [flipPromoted, setFlipPromoted] = useState(Boolean(sourceRect));
  // Слот действий шапки: карточка переносит сюда свои кнопки порталом
  // (#735/#746) — хост стека не знает их состояния.
  const [headerActionsHost, setHeaderActionsHost] = useState<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Правый край карточки = правый край мягкой рамы = левый край служебной
  // полосы (план R4): полоса ЗА пределами рамы, карточка её не накрывает и
  // сужается синхронно с рамой при раскрытии полосы кнопкой (transition-[right] той
  // же длительности, что transition-[width] полосы). На модуле мессенджер
  // полоса скрыта (useRailHidden) — stripW=0; фулскрин-карточка мессенджера
  // (fullscreen) доходит до края периметра всегда: inset-2 даёт те же 8px,
  // что у рамы, и накрывает полосу собой (план messenger-fullscreen).
  const railHidden = useRailHidden();
  // Окно ассистента — оверлей внутри рамы: геометрию карточек не двигает.
  const stripW = fullscreen || railHidden ? 0 : EDGE_W_COLLAPSED;
  // Верхняя кромка карточки (#1038, вердикт владельца 25.11): в оболочке —
  // ПОД строкой панели безрамочного окна с тем же зазором периметра (8css),
  // иначе карточка накрывала вкладки/⟳/адрес; в браузере — от края окна,
  // как прежде. Правая/нижняя кромки не менялись.
  const cardTop = uiPx(8) + shellPanelHeight();

  function requestClose() {
    if (closingRef.current) return;
    // Сигнал нижним карточкам и контуру шелла: верхняя пошла закрываться —
    // они просыпаются ДО схлопывания (issue #63: lower cards отрисовываются
    // в окне гашения контента, контур перемеряется под уходящей карточкой).
    useShellStore.getState().setCardClosing(true);
    const el = panelRef.current;
    if (!sourceRect || !el) {
      closeRef.current();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    // Промоушен на время схлопывания: композитор не пересоздаёт слой
    // каждый кадр, закрытие остаётся плавным; после — снимаем (#969).
    el.style.willChange = 'transform';
    const dst = el.getBoundingClientRect();
    const to = `translate(${sourceRect.x - dst.x}px, ${sourceRect.y - dst.y}px) scale(${sourceRect.width / dst.width}, ${sourceRect.height / dst.height})`;
    const anim = el.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: to, opacity: 0.35 },
      ],
      { duration: CLOSE_MS, delay: CONTENT_FADE_MS, easing: CLOSE_EASE, fill: 'both' },
    );
    // Отменённая анимация (cancel() извне, display:none у предка) onfinish
    // НЕ стреляет — без oncancel панель зависала бы в closing навсегда
    // (контент погашен, клики глотаются). Закрытие — строго однократно:
    // cancel уже доигравшей (fill: both) анимации не должен закрыть второй раз.
    let closed = false;
    const finishClose = () => {
      if (closed) return;
      closed = true;
      el.style.willChange = '';
      closeRef.current();
    };
    anim.onfinish = finishClose;
    anim.oncancel = finishClose;
  }

  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    stack.push(id);
    // Доступность (аудит #45): запоминаем фокус-триггер для возврата,
    // стартовый фокус — на «Закрыть», Tab циклирует внутри панели (trap).
    // Возврат фокуса — ТОЛЬКО при открытии КЛАВИАТУРОЙ (input-modality):
    // иначе строка-источник после Esc получает focus-visible рамку —
    // мышевому пользователю читалось «жирной толстой рамкой» (баг-вердикт
    // 15.09.2026); клавиатурному пользователю возврат обязателен (a11y).
    const openedVia = inputModality();
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (event.key === 'Tab') {
        const el = panelRef.current;
        if (!el) return;
        const focusables = el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !el.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !el.contains(active))) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      // Esc внутри открытого меню/поповера Radix закрывает МЕНЮ, не слайдер:
      // этот слушатель на window видит то же событие ПОСЛЕ document-обработчиков
      // Radix (баблинг document → window), поэтому отфильтровываем обработанное.
      if (event.defaultPrevented) return;
      if (hasOpenPopperLayer()) return;
      requestCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    closeButtonRef.current?.focus();
    return () => {
      const index = stack.indexOf(id);
      if (index >= 0) stack.splice(index, 1);
      window.removeEventListener('keydown', onKey);
      // Закрывающаяся карточка ушла из стека — нижние уже отрисованы, режим
      // закрытия снимается (владелец сигнала — панель, которая его подняла).
      useShellStore.getState().setCardClosing(false);
      if (openedVia === 'keyboard') previouslyFocused?.focus();
    };
  }, [id]);

  /** Монтирование тяжёлого контента ПОСЛЕ первого отрисованного кадра панели:
   *  double rAF гарантирует, что хром панели (пустая оболочка) уже отрисован,
   *  анимация раскрытия стартовала и ушла на композитор — синхронный маунт
   *  дерева карточки (десятки мс на первом открытии) не задерживает её кадры. */
  const [contentMounted, setContentMounted] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setContentMounted(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  // Раскрытие осело — снимаем промоушен слоя (#969): постоянный `will-change`
  // держал содержимое растром масштаба источника, и текст/фото «мылились» до
  // первой перерисовки. Слушатель нативный: animationend всплывает и от
  // дочерних content-fade — фильтруем по target (анимация самой панели).
  // Во время закрытия промоушен НЕ снимаем: он только что поставлен перед
  // WAAPI-схлопыванием и должен жить до конца анимации.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !sourceRect) return;
    const onEnd = (event: AnimationEvent) => {
      if (event.target === el && !closingRef.current) setFlipPromoted(false);
    };
    el.addEventListener('animationend', onEnd);
    return () => el.removeEventListener('animationend', onEnd);
  }, [sourceRect]);

  /** FLIP-переменные раскрытия: геометрия панели детерминирована (inset-2
   *  внутри хоста, чей правый край = левый край служебной полосы, ADR-0009 +
   *  план R4), поэтому дельты считаются без замеров; анимация — CSS @keyframes
   *  slider-expand (стартует с первого кадра на любом окружении, в отличие от
   *  transition/WAAPI на маунте). */
  const flipStyle: CSSProperties | undefined = sourceRect
    ? (() => {
        const dst = {
          x: uiPx(8),
          y: cardTop,
          w: window.innerWidth - stripW - uiPx(16),
          h: window.innerHeight - cardTop - uiPx(8),
        };
        return {
          '--flip-tx': `${sourceRect.x - dst.x}px`,
          '--flip-ty': `${sourceRect.y - dst.y}px`,
          '--flip-sx': `${sourceRect.width / dst.w}`,
          '--flip-sy': `${sourceRect.height / dst.h}`,
        } as CSSProperties;
      })()
    : undefined;

  return (
    <div
      /* Хост НЕ ЛОВИТ клики (pointer-events-none): он выше панели оболочки
         (z-50 > z-40) и во всю высоту окна — без этого съедал клики по
         строке панели (вкладки/⟳/адрес) даже при опущенной карточке
         (#1038, вердикт владельца 25.11). Ловят только дети ниже. */
      className="pointer-events-none fixed inset-y-0 left-0 z-50 transition-[right] duration-200 ease-out"
      style={{ right: stripW, contentVisibility: dormant ? 'hidden' : 'visible' }}
    >
      {/* Накрытая карточка (#63) — не видимая поверхность (#770): её ленты,
          квитанции прочтения и попапы обязаны молчать. */}
      <SurfaceVisibilityProvider visible={!dormant}>
        {/* Прозрачный click-catcher вместо затемняющего задника: страница за
          панелью цвета не меняет; клик мимо панели закрывает её. Начинается
          ОТ верхней кромки карточки: строка панели оболочки (вкладки, ⟳,
          адрес) ЛОВУШКОЙ не накрыта — клики до неё доезжают при открытой
          карточке (#1038, вердикт владельца 25.11). */}
        <div
          className="pointer-events-auto absolute inset-x-0 bottom-0"
          style={{ top: cardTop }}
          onClick={requestClose}
          aria-hidden="true"
        />
        <CardHeaderActionsContext.Provider value={headerActionsHost}>
          <section
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            /* Карточка — ПОВЕРХНОСТЬ, а не модальный слой (#809): её видимость
               несёт SurfaceVisibilityProvider; реестр modal-layers по этому
               маркеру исключает её из «поверхность перекрыта». */
            data-card-surface=""
            aria-labelledby={title && !headerContent ? `${id}-title` : undefined}
            style={{
              top: cardTop,
              ...(flipStyle ?? {}),
              willChange: flipPromoted ? 'transform' : undefined,
            }}
            className={cn(
              'slider-shadow pointer-events-auto absolute right-2 bottom-2 left-2 z-20 flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground',
              sourceRect ? 'slider-expand' : 'slider-pop',
            )}
          >
            <header
              data-card-topbar={cardTopbar ? 'true' : undefined}
              className={cn(
                // cardTopbar: бордюра НЕТ — нижнюю линию хедера рисует контур
                // (ось шины на headerRect.bottom, 0.32 opacity) ровно как в
                // топбаре шелла: карточка-мессенджер выглядит как страница.
                'flex h-12 shrink-0 items-center gap-2 px-3',
                '*:transition-opacity *:duration-100',
                !cardTopbar && 'border-b border-border',
                sourceRect && !closing && 'content-fade',
                // Фаза 1 закрытия: контент ГАСНЕТ за 100 мс (не мгновенно — одним
                // кадром это читалось «вспышкой на весь экран»), затем оболочка
                // схлопывается в источник (баг-вердикты владельца 15.09.2026:
                // «текст отпечатывается на главной» → «теперь вспышка»).
                closing && '*:opacity-0',
              )}
            >
              <Button
                ref={closeButtonRef}
                variant="ghost"
                size="icon"
                className="shrink-0 hover:bg-accent"
                onClick={requestClose}
                aria-label={ui.common.close}
              >
                <X />
              </Button>
              {/* Хлебные крошки убраны (вердикт владельца); вместо них — главное
              название сущности: на видном месте, один раз, в теле карточки
              не дублируется. Фулскрин-карточка мессенджера — вместо названия
              вкладки-порты (headerContent). Кегль титула 18px/600 — по замеру
              Битрикс24 (ambient-проба владельца 21.09.2026: титул задачи
              21px/600; наш хедер плотнее (h-12) — та же роль в нашем масштабе). */}
              {headerContent ??
                (title ? (
                  <span
                    id={`${id}-title`}
                    className="min-w-0 truncate text-lg font-semibold text-foreground"
                  >
                    {title}
                  </span>
                ) : null)}
              <div
                ref={setHeaderActionsHost}
                className="ml-auto flex min-w-0 shrink-0 items-center gap-1"
              >
                {headerActions}
              </div>
            </header>
            <div
              className={cn(
                'min-h-0 flex-1 overflow-hidden transition-opacity duration-100',
                fadeContent && sourceRect && !closing && 'content-fade',
                // Фаза 1 закрытия: тело гаснет за 100 мс (см. хром выше).
                closing && 'opacity-0',
              )}
            >
              {contentMounted ? children : null}
            </div>
          </section>
        </CardHeaderActionsContext.Provider>
      </SurfaceVisibilityProvider>
    </div>
  );
}
