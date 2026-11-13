/**
 * Решение «видно/не видно» для прыжка к сообщению (вердикт владельца
 * 25.09, п.1: переход по цитатам/закрепам НЕ отрывает низ ленты):
 * - цель ПОЛНОСТЬЮ видна в контейнере прокрутки → только вспышка-подсветка,
 *   скролла НЕТ (ноль движения при клике по видимой цитате);
 * - цель не видна (или видна частично) → плавный скролл ВНУТРИ контейнера
 *   ленты с выравниванием по центру, ЗАЖАТЫЙ диапазоном [0, maxScroll]:
 *   центр никогда не требует прокрутки за пределы контента, поэтому низ
 *   ленты остаётся прижат к низу области — «дыры» снизу и пустых зон нет.
 *
 * Почему не scrollIntoView и не scrollToMessage примитива MessageScroller:
 * нативный scrollIntoView скроллит ВСЕ прокручиваемые предки (лента может
 * уехать вместе со страницей), а примитив при align:'center' ДОРАЩИВАЕТ
 * спейсер снизу, чтобы дотянуться до центра — именно так возникала «дыра».
 */

export type RevealOutcome = 'visible' | 'scrolled';

/** Допуск на субпиксельные расхождения getBoundingClientRect. */
const EPSILON = 1;
/** Длительность собственной плавной прокрутки (нативная не корректируется). */
const SMOOTH_SCROLL_MS = 320;

/** Цель полностью в области прокрутки (без обрезки сверху/снизу). */
export function isMessageFullyVisible(el: HTMLElement, container: HTMLElement): boolean {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.top >= c.top - EPSILON && r.bottom <= c.bottom + EPSILON;
}

/**
 * Показать цель: 'visible' — уже видна целиком (скролл не трогаем);
 * 'scrolled' — плавный центрирующий скролл внутри контейнера с клампом.
 * Возвращает исход, чтобы вызывающий не решил «скролл = всегда».
 */
export function revealMessage(el: HTMLElement, container: HTMLElement): RevealOutcome {
  if (isMessageFullyVisible(el, container)) return 'visible';
  scrollMessageIntoView(el, container, { align: 'center', behavior: 'smooth' });
  return 'scrolled';
}

/**
 * Программный скролл к сообщению ВНУТРИ контейнера с клампом [0, maxScroll]
 * (раунд 4). Канон для ВСЕХ якорных скроллов чата (якорь непрочитанных,
 * jump-цель открытия, стрелка «вниз»): примитивный scrollToMessage при
 * align:start/center ДОРАЩИВАЕТ спейсер ПОД контентом, когда цель в последнем
 * экране, — между последним пузырём и композером вырастает пустота, которая
 * не смывается обычной прокруткой (вердикт владельца раунда 4: «огромный
 * зазор под Просмотрено»). Кламп держит низ ленты прижатым к низу области.
 *
 * Settle-коррекция: строки ленты несут content-visibility:auto — размеры
 * строк ВНЕ вьюпорта оценочные (contain-intrinsic-size), поэтому первый
 * scrollTo садится по оценочной геометрии и может промахнуться; короткая
 * rAF-петля (~0.5 c) доводит scrollTop по живой геометрии цели и гаснет.
 * Пользовательский скролл (колесо/тач) прерывает коррекцию немедленно.
 *
 * Плавный режим (#845) — та же логика, но сразу: собственная анимация с
 * пересчётом цели КАЖДЫЙ кадр (easeOutCubic). Нативная `behavior:'smooth'`
 * целится один раз по оценочной геометрии и промахивается — к концу
 * навигации лента должна быть уже отрисована и стоять точно на цели.
 */
/** Целевой scrollTop для выравнивания цели с клампом [0, maxScroll]
 *  (чистая функция — юнит-тест; и плавная анимация, и авто-режим считают ей). */
export function scrollTopFor(
  el: HTMLElement | (() => HTMLElement | null),
  container: HTMLElement,
  options: { align: 'start' | 'center'; margin?: number },
): number {
  const node = typeof el === 'function' ? el() : el;
  if (!node) return container.scrollTop;
  const c = container.getBoundingClientRect();
  const r = node.getBoundingClientRect();
  const targetTop = r.top - c.top + container.scrollTop;
  const desired =
    options.align === 'start'
      ? targetTop - (options.margin ?? 0)
      : targetTop - (container.clientHeight - r.height) / 2;
  const max = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.min(Math.max(desired, 0), max);
}

export function scrollMessageIntoView(
  el: HTMLElement | (() => HTMLElement | null),
  container: HTMLElement,
  options: { align: 'start' | 'center'; margin?: number; behavior?: ScrollBehavior },
): void {
  // Резолвер, а не узел: во время анимации React может пересоздать строку
  // (рефеч/прочтения), захваченный DOM-узел «отсыхает» (rect → 0) и цель
  // уезжает в начало. Перезапрос каждый кадр держит цель живой (#845).
  const desiredTop = () => scrollTopFor(el, container, options);
  if (options.behavior === 'smooth') {
    const startTop = container.scrollTop;
    const startedAt = performance.now();
    let stopped = false;
    const stop = (): void => {
      stopped = true;
      container.removeEventListener('wheel', stop);
      container.removeEventListener('touchstart', stop);
    };
    container.addEventListener('wheel', stop, { passive: true });
    container.addEventListener('touchstart', stop, { passive: true });
    const step = (): void => {
      if (stopped) return;
      const t = Math.min(1, (performance.now() - startedAt) / SMOOTH_SCROLL_MS);
      const ease = 1 - (1 - t) ** 3;
      container.scrollTop = startTop + (desiredTop() - startTop) * ease;
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      container.scrollTop = desiredTop(); // финальный снап по живой геометрии
      stop();
    };
    requestAnimationFrame(step);
    return;
  }
  container.scrollTo({ top: desiredTop(), behavior: 'auto' });

  let frames = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    container.removeEventListener('wheel', stop);
    container.removeEventListener('touchstart', stop);
  };
  container.addEventListener('wheel', stop, { passive: true });
  container.addEventListener('touchstart', stop, { passive: true });
  const tick = () => {
    const node = typeof el === 'function' ? el() : el;
    if (stopped || frames > 30 || !node) {
      stop();
      return;
    }
    frames += 1;
    const c = container.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    const want =
      options.align === 'start'
        ? c.top + (options.margin ?? 0)
        : c.top + (container.clientHeight - r.height) / 2;
    const delta = r.top - want;
    if (Math.abs(delta) > 2) {
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = Math.min(Math.max(container.scrollTop + delta, 0), max);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
