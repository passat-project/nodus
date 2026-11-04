import { useCallback, useRef, useState, type PointerEvent, type RefObject } from 'react';

import { uiPx } from './ui-scale.js';

const STORE_KEY = 'nodus-card-chat-w-v2';
const DEFAULT_W = uiPx(680);
/** Пол колонки чата при drag (без панелей): экспортирован для рендер-формулы
 *  «чат — буфер сужений»: рефлоу рельсы сужает чат до этого пола, дальше
 *  сужение выталкивает левую зону карточки (канон, issue #63). */
export const MIN_CHAT_W = uiPx(420);
const MIN_W = MIN_CHAT_W;
/** Доля вьюпорта: чат может стать главным, но не выжать содержание целиком.
 *  0.85 (ред. 04.11.2026): на большом мониторе прежние 0.66 упирали чат
 *  раньше минимума левой панели — данные стояли с огромными полями, хотя
 *  панель ещё можно было тянуть. Теперь первым упирается минимум колонки
 *  данных (320), а не доля вьюпорта. */
const MAX_RATIO = 0.85;

/** Минимум ширины чата ПРИ ОТКРЫТОЙ панели карточки задачи («О задаче» или
 *  навигатор ветки, #365): чат сужается до него, дальше — порядок уступок
 *  ряда карточки. */
export const MIN_CHAT_WITH_PANEL = uiPx(280);

function clamp(width: number) {
  return Math.min(Math.max(width, MIN_W), Math.round(window.innerWidth * MAX_RATIO));
}

/**
 * Ширина колонки чата в карточке сущности (задача/проект/сотрудник —
 * закон: где чат, там перегородка двигается с памятью): тянется за
 * разделитель мышью (как сплит в IDE), сохраняется в localStorage — общая
 * память на все карточки портала, дефолт 680px.
 *
 * Drag — ИМПЕРАТИВНО (el.style.width напрямую), БЕЗ setState на каждый кадр:
 * React не рендерит карточку во время тяги (дерево сообщений/полей не
 * пересчитывается — вердикт владельца о лагах); React-state и localStorage
 * обновляются один раз на pointerup. Transition на ширине — только для
 * программных toggle (панель «О задаче» сужает чат), во время drag снят
 * (флаг dragging → gotchas: transition при ручном ресайзе = фризы).
 *
 * @param chatRef — колонка чата, которой drag выставляет ширину напрямую;
 * @param shrink — сколько px временно съедает открытая панель «О задаче»;
 * @param floor — нижний порог ширины колонки при drag (карточки с панелью
 *  беседы: не дать сузить колонку ниже «лента 360 + панель 300»).
 */
export function useChatWidth(
  chatRef: RefObject<HTMLDivElement | null>,
  shrink = 0,
  floor = MIN_CHAT_WITH_PANEL,
) {
  const [chatW, setChatW] = useState(() => {
    const stored = Number(localStorage.getItem(STORE_KEY));
    return Number.isFinite(stored) && stored >= MIN_W ? clamp(stored) : DEFAULT_W;
  });
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(chatW);
  widthRef.current = chatW;
  const shrinkRef = useRef(shrink);
  shrinkRef.current = shrink;
  const floorRef = useRef(floor);
  floorRef.current = floor;

  const onDividerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startW = widthRef.current;
      let latest = startW;
      let raf = 0;
      setDragging(true);
      const onMove = (ev: globalThis.PointerEvent) => {
        latest = clamp(startW + (startX - ev.clientX));
        // Не чаще одного кадра (pointermove идёт плотнее refresh rate).
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const el = chatRef.current;
          if (el) el.style.width = `${Math.max(latest - shrinkRef.current, floorRef.current)}px`;
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (raf) cancelAnimationFrame(raf);
        setDragging(false);
        // Коммит в React: стиль ре-рендера совпадает с последним императивным
        // значением — визуального скачка нет.
        setChatW(latest);
        localStorage.setItem(STORE_KEY, String(latest));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [chatRef],
  );

  return { chatW, onDividerDown, dragging };
}
