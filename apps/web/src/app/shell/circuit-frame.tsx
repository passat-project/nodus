// >300 строк — обоснование (I5): ОДИН SVG-слой контура и его жизненный цикл
// (сон под карточкой/пробуждение по cardClosing, оседание FLIP, гвард вспышки
// на переходной геометрии, отложенная вспышка) — одна машина состояний на
// общих refs (pathname/cardModeLive/covered/moving/prevFocus). Чистая
// геометрия уже вынесена в circuit-geometry.ts, покадровое движение панелей —
// в use-geometry-motion.ts; дальнейший разнос (вспышка отдельным хуком)
// протаскивал бы те же 6 refs через границу хука без выигрыша. Заметная
// доля объёма — канон-комментарии вердиктов владельца (их не сокращаем).
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { NodeEdge, pathLength, snapPx, type NodeEdgePoint } from '@nodus/ui/components/node-edge';
import { cn } from '@nodus/ui/lib/utils';

import { parseCardStack } from './card-stack.js';
import {
  CIRCUIT_REMEASURE,
  currentFocus,
  framePath,
  measureCircuit,
  transitionPulse,
  type CircuitFocus,
  type CircuitGeometry,
} from './circuit-geometry.js';
import { useShellStore } from './shell-store.js';
import { useGeometryMotion } from './use-geometry-motion.js';

function focusSig(f: CircuitFocus | null): string {
  return f ? `${f.moduleTo}|${f.tabLabel ?? ''}` : '';
}

/** Отсрочка первого замера в режиме карточки: `slider-expand` (430 мс)
 *  трансформирует всю карточку вместе с хедером — rect'ы переходные;
 *  контур появляется одним кадром на осевшей геометрии. Она же — задержка
 *  засыпания под НЕфулскрин-карточкой (issue #63): пока кадр раскрытия
 *  дорисовывается, старый контур шелла ещё корректен. */
const CARD_SETTLE_MS = 480;

/**
 * Перманентный контур Nodus (реф node-based UI): единая связь слева направо —
 * стык (круглое сопряжение, без точки) → ось шапки до самого правого края
 * (контур ЗАМЕНЯЕТ бордюр и сливается с классической разметкой) — плюс шина
 * рейки с локтевыми отводами к портам модулей единым блоком и засечки вверх
 * к точкам вкладок (точка — у самого пункта, на оси точек нет). Вспышка —
 * ПОДСВЕТКА-РИСОВКА линии к активному подменю, БЕЗ бегущего импульса-точки
 * (вердикт начальника 01.10 #179: шарик поверх подсветки излишен —
 * достаточно первичной подсветки), только на СМЕНУ фокуса: на сворачивание/
 * разворачивание панелей ЗАПРЕЩЕНА флагом width-transition (вердикт владельца
 * 14.09.2026: пульс на переходной геометрии улетал поверх рейки). Геометрия —
 * измерение DOM по data-атрибутам; пересчёт на resize, скролл навигатора и
 * покадрово во время transition ширины панелей.
 *
 * РЕЖИМ КАРТОЧКИ (план messenger-fullscreen): вершина стека — полноэкранная
 * карточка мессенджера → контур измеряется по её хедеру (`data-card-topbar`)
 * и рисуется ПОверх карточки (z-[60]); шина — урезанная, как у схлопнутой
 * рейки: узел-точка на левой границе карточки, ось до её правого края,
 * засечки к вкладкам карточки; первый замер — после оседания FLIP-раскрытия
 * (CARD_SETTLE_MS), перемер на смену вкладок — по событию CIRCUIT_REMEASURE.
 */
export function CircuitFrame() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const menuCollapsed = useShellStore((s) => s.menuCollapsed);
  // Верхняя карточка стека начала закрываться (SliderPanel.requestClose):
  // сигнал пробуждения контура и нижних карточек ДО схлопывания (issue #63).
  const cardClosing = useShellStore((s) => s.cardClosing);
  // Вершина стека (?cards=): ЛЮБАЯ карточка накрывает мягкую раму целиком
  // (inset-2 = прямоугольник рамы); фулскрин-мессенджер — до края периметра.
  const topKind = useMemo(() => {
    const stack = parseCardStack(new URLSearchParams(searchStr).get('cards'));
    return stack[stack.length - 1]?.kind;
  }, [searchStr]);
  const cardMode = topKind === 'messenger';
  // Режим КАРТОЧКИ «живьём»: выключается СРАЗУ по cardClosing — схлопывающаяся
  // карточка уже открывает шелл, контур обязан быть на месте к первому кадру
  // открытия (issue #63); сам cardMode (по ?cards=) сойдёт лишь после unmount.
  const cardModeLive = cardMode && !cardClosing;
  // Контур шелла НЕВИДИМ: любая верхняя карточка (не в фазе закрытия) накрывает
  // раму — измерять и тем более мерить покадрово нечего (сон, issue #63).
  const covered = topKind !== undefined && !cardClosing;
  const [geo, setGeo] = useState<CircuitGeometry | null>(null);
  const [pulse, setPulse] = useState<{
    points: NodeEdgePoint[];
    dot: boolean;
    fadeMs: number;
  } | null>(null);
  const [pulseRun, setPulseRun] = useState(0);
  const prevFocus = useRef<CircuitFocus | null>(null);
  /** Живые значения для слушателей-колбэков: transitionrun может прийти раньше
   *  следующего рендера, а «догоняющая» вспышка обязана мерить маршрут и режим
   *  АКТУАЛЬНЫЕ (иначе её путь — по геометрии прошлого модуля). */
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const cardModeLiveRef = useRef(cardModeLive);
  cardModeLiveRef.current = cardModeLive;
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  /** Живой пересчёт контура и кадровый цикл движения панелей: хук движения
   *  зовёт их из слушателей (вне рендер-скоупа эффекта контура). */
  const remeasureRef = useRef<() => void>(() => {});
  const loopRef = useRef(0);

  /** Раскрытие фулскрин-карточки (FLIP-анимация): замеры глушатся до оседания
   *  (CARD_SETTLE_MS) — геометрия хедера в transform-переходе «плавает». */
  const settling = useRef(false);
  /** Ширины контейнеров каркаса в transition (рейка, служебная полоса): пока
   *  геометрия едет, вспышка на смену фокуса ЗАПРЕЩЕНА (вердикт владельца
   *  14.09.2026: пульс на переходной геометрии «вылетает непонятно куда»).
   *  Снимает гвард хук `useGeometryMotion` — по ПОСЛЕДНЕЙ транзиции серии. */
  const moving = useRef(false);
  const setMoving = (v: boolean) => {
    moving.current = v;
  };

  const pulseTimer = useRef(0);

  /** Сворачивание/разворачивание левого меню (#235): width-transition рейки
   *  стартует в кадре ПОСЛЕ коммита, и transitionrun может прийти позже
   *  первого замера — вспышка успевала выстрелить по переходной геометрии.
   *  Гвард ставим сами, не дожидаясь события; страховочный таймер — если
   *  transition не случится. Настоящий transitionend снимет флаг раньше и
   *  перемерит контур. */
  const prevMenuCollapsed = useRef(menuCollapsed);
  useLayoutEffect(() => {
    if (prevMenuCollapsed.current === menuCollapsed) return;
    prevMenuCollapsed.current = menuCollapsed;
    setMoving(true);
    const settle = window.setTimeout(() => {
      setMoving(false);
    }, 360);
    return () => window.clearTimeout(settle);
  }, [menuCollapsed]);

  /** Одиночный пульс с авто-затуханием; длительность затухания — из длины
   *  маршрута (рисовка + догорание), иначе дальняя подсветка обрывается. */
  const firePulse = useCallback((points: NodeEdgePoint[], dot: boolean) => {
    window.clearTimeout(pulseTimer.current);
    const len = pathLength(points);
    const fadeMs = (len / 1200 + 0.9) * 1000;
    setPulse({ points, dot, fadeMs });
    setPulseRun((k) => k + 1);
    pulseTimer.current = window.setTimeout(() => setPulse(null), fadeMs);
  }, []);

  /** Отложенная вспышка не должна «сгореть»: следом начавшееся движение
   *  (быстрый клик по модулям подряд раньше оседания) отменяет settle-кадр —
   *  пульс предыдущего фокуса рисуем на свежем замере; фокус сменился ещё раз —
   *  settle-кадр нарисует следующий. */
  const fireDuePulse = () => {
    const g = measureCircuit(pathnameRef.current, cardModeLiveRef.current);
    if (!g) return;
    const next = currentFocus(g);
    if (focusSig(next) === focusSig(prevFocus.current)) return;
    const p = transitionPulse(g, prevFocus.current);
    prevFocus.current = next;
    if (p) firePulse(p.points, p.dot);
  };

  useLayoutEffect(() => {
    // СОН под НЕфулскрин-карточкой (issue #63): карточка накрывает мягкую раму
    // целиком — контур невидим, а рефлоу полосы под ней крутил покадровый
    // forced-layout (measureCircuit = чтение rect'ов) + SVG-ре-рендер. Спим:
    // один замер (сквозь FLIP/scale-fade раскрытия контур ещё у места),
    // geo=null после оседания, слушателей НЕТ. Пробуждение — cardClosing
    // (covered → false): эффект перезапускается рабочим режимом и перемеряет
    // шелл ДО схлопывания карточки, открывая его контуром.
    if (covered && !cardModeLive) {
      setMoving(false);
      remeasureRef.current = () => {};
      let settle = 0;
      const raf = requestAnimationFrame(() => setGeo(measureCircuit(pathname, false)));
      settle = window.setTimeout(() => setGeo(null), CARD_SETTLE_MS);
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(settle);
      };
    }
    let raf = 0;
    let settle = 0;
    const applyGeo = () => {
      if (settling.current) return;
      setGeo(measureCircuit(pathname, cardModeLive));
    };
    const remeasure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(applyGeo);
    };
    // Хук движения снимает гвард и перемеряет контур на осевшей геометрии —
    // через живой реф (его хуку виден только актуальный замер).
    remeasureRef.current = remeasure;
    // Режим карточки включается: контур гаснет (шина шелла уходит под карточку)
    // и возвращается одним замером, когда FLIP-раскрытие осело.
    settling.current = cardModeLive;
    if (cardModeLive) {
      setGeo(null);
      settle = window.setTimeout(() => {
        settling.current = false;
        remeasure();
      }, CARD_SETTLE_MS);
    }
    remeasure();
    const ro = new ResizeObserver(remeasure);
    ro.observe(document.documentElement);
    document.addEventListener('scroll', remeasure, { capture: true, passive: true });
    // Вкладки фулскрин-карточки — локальное состояние (не маршрут): хром шлёт
    // CIRCUIT_REMEASURE после коммита data-active — перемер и вспышка фокуса.
    window.addEventListener(CIRCUIT_REMEASURE, remeasure);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      ro.disconnect();
      document.removeEventListener('scroll', remeasure, { capture: true });
      window.removeEventListener(CIRCUIT_REMEASURE, remeasure);
    };
    // searchStr в deps НЕ входит намеренно: замеры зависят только от режимов
    // (cardModeLive/covered) — подмена вершины стека (replaceTop, та же kinds)
    // не перезапускает режим карточки и не гасит контур на CARD_SETTLE_MS.
  }, [pathname, menuCollapsed, cardModeLive, covered]);

  /** Движение ширин контейнеров (рейка, служебная полоса) — общий хук:
   *  гвард `moving` держится до ПОСЛЕДНЕЙ транзиции серии, покадровый замер
   *  ведёт контур за панелями, settle-кадр на осевшей геометрии снимает гвард
   *  и перемеряет (детали и механика — use-geometry-motion.ts). */
  useGeometryMotion({
    // Новое движение началось, а смена фокуса ещё не нарисована: либо у
    // предыдущего движения отменён кадр оседания (pendingSettle), либо гвард
    // уже стоял (створка пре-арма меню/предыдущий run серии). Дорисовываем на
    // свежем замере. Дубля нет — settle настоящего движения сработает, лишь
    // если фокус сменится ЕЩЁ раз (prevFocus уже актуален).
    onRun: ({ pendingSettle }) => {
      if (pendingSettle || moving.current) fireDuePulse();
    },
    onSettle: () => {
      setMoving(false);
      remeasureRef.current();
    },
    onFrames: (active) => {
      cancelAnimationFrame(loopRef.current);
      loopRef.current = 0;
      if (!active || coveredRef.current || cardModeLiveRef.current) return;
      const tick = () => {
        setGeo(measureCircuit(pathnameRef.current, false));
        loopRef.current = requestAnimationFrame(tick);
      };
      loopRef.current = requestAnimationFrame(tick);
    },
  });

  useLayoutEffect(() => {
    if (!geo) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const next = currentFocus(geo);
    // Кадровый пересчёт во время движения панелей: фокус НЕ трогаем (ни
    // вспышка, ни запись): промежуточные замеры несут уже НОВЫЙ модуль —
    // запись «съедала» смену фокуса, и к оседанию геометрии (settle-кадр)
    // prev уже совпадал с next — вспышка не стреляла вовсе (баг 14.10:
    // переход на/с мессенджера прячет правую полосу width-анимацией —
    // вспышка глохла на нём и на соседних модулях).
    if (moving.current) return;
    if (!reduced && focusSig(next) !== focusSig(prevFocus.current)) {
      const p = transitionPulse(geo, prevFocus.current);
      if (p) firePulse(p.points, p.dot);
    }
    prevFocus.current = next;
  }, [geo, firePulse]);

  if (!geo) return null;
  return (
    // Режим карточки: контур ПОверх фулскрин-карточки (z-50 слайдера), но под
    // оверлей-порталами (z-70+: меню, поповеры, лайтбокс) — лестница z канона.
    <div
      className={cn('pointer-events-none fixed inset-0', geo.cardMode ? 'z-[60]' : 'z-30')}
      aria-hidden
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        style={{ opacity: 0.32, willChange: 'opacity' }}
      >
        {/* Прозрачность — CSS-opacity ОТДЕЛЬНОГО svg-элемента + форсированный
            композитный слой (will-change): без слоя Chromium сворачивает
            opacity в alpha кисти и самопересечения подпутей (подходы отводов
            к шине, засечек к оси) композитятся дважды — «хвостики ярче шины»
            при зуме ≤ 100%. Со слоем буфер рисуется полным alpha, opacity —
            на композите (замерено: 130 → 82, ровно как чистая шина).
            Порты — в соседнем svg полным alpha. */}
        <path d={framePath(geo)} fill="none" stroke="var(--foreground)" strokeWidth="1" />
      </svg>
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {/* Узел бокового шва схлопнутой рейки — точка 5px (r2 + stroke1) на
            оси в месте стыка: рисуется здесь, а не в DOM рейки, иначе
            overflow-hidden рейки срезает половину точки («сплющивает»).
            ТОЛЬКО при наличии вкладок (баг-вердикт 15.09.2026: на Главной со
            схлопнутой рейкой связи нет — точка-сирота и вспышка запрещены;
            на модулях с подмодулями узел и связи остаются). */}
        {geo.leftNode && geo.tabs.length > 0 ? (
          <circle
            cx={snapPx(geo.leftNode.x + 0.5)}
            // cy — ТА ЖЕ снапленная ось, что у линии: `leftNode.y` и есть
            // axisY (фудж +0.5, подобранный под рем-якорь, снят — #851).
            cy={snapPx(geo.leftNode.y)}
            r="2"
            // Режим карточки: узел сидит на границе карточки — тон карточки
            // (тон периметра/рейки читался бы чужой заплатой).
            fill={geo.cardMode ? 'var(--card)' : 'var(--sidebar)'}
            stroke="var(--edge)"
          />
        ) : null}
        {/* Терминальная точка модуля БЕЗ подмодулей (Главная развёрнутая):
            шина заканчивается узлом на линии шапки — плоского среза нет
            (вердикт 14.09.2026 вечером: ничего не торчит). */}
        {geo.terminus ? (
          <circle
            cx={snapPx(geo.terminus.x + 0.5)}
            // Терминал стоит НА оси — та же снапленная координата, что у линии (#851).
            cy={snapPx(geo.terminus.y)}
            r="2"
            fill="var(--sidebar)"
            stroke="var(--edge)"
          />
        ) : null}
        {geo.tabs.map((t) => (
          <circle
            key={t.x}
            cx={snapPx(t.x)}
            cy={snapPx(geo.tabY)}
            r="2.5"
            fill={t.active ? 'var(--port)' : 'var(--background)'}
            stroke={t.active ? 'var(--port)' : 'var(--edge)'}
            style={t.active ? { filter: 'drop-shadow(0 0 6px var(--glow))' } : undefined}
          />
        ))}
      </svg>
      {pulse ? (
        <div
          key={pulseRun}
          className="dock-edge-fade absolute inset-0"
          style={{ animationDuration: `${pulse.fadeMs}ms` }}
        >
          <NodeEdge points={pulse.points} ports={pulse.dot ? 'end' : 'none'} drawOn active />
        </div>
      ) : null}
    </div>
  );
}
