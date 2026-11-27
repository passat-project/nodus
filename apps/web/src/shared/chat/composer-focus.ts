import { wsDebugEnabled } from '../socket/ws-debug.js';
import { useAttachSendDialog } from './dialog-stores.js';

/**
 * «Вечный курсор» композера (канон Телеграм, вердикт владельца 14.09.2026):
 * пока открыт чат/канал/тред — мигающий курсор живёт в его композере; обычные
 * клики по UI (карточки, кнопки, пустое место, пункты меню) возвращают фокус
 * в активный композер. Фокус ПЕРЕДАЁТСЯ только вручную: клик по другому
 * редактируемому полю (другой композер, поиск, палитра) делает его активным
 * владельцем курсора либо временно (не-композер: следующий обычный клик
 * вернёт курсор в композер).
 *
 * Правила безопасности (иначе «вечный фокус» ломает продукт):
 * - клавиатура (Tab) фокус НЕ возвращает — иначе ловушка фокуса для
 *   клавиатурной навигации (модальность отслеживается pointerdown/keydown);
 * - несвёрнутая селекция текста фокус НЕ возвращает — выделение и копирование
 *   текста сообщения важнее мигающего курсора;
 * - открытый оверлей-слой (диалог, поповер, меню, селект — role на контенте
 *   Radix) владеет фокусом: пока `activeElement` внутри слоя, курсор НЕ
 *   возвращается — иначе DismissableLayer закроет панель по focusOutside
 *   (баг #71: пикер даты в карточке регистрации вспыхивал и пропадал).
 *   Канон сохраняется: после закрытия слоя автофокус Radix возвращает фокус
 *   на триггер, focusin-гард планирует steal уже вне слоя;
 * - слой владеет фокусом и ЧЕРЕЗ свой ТРИГГЕР: клик открывает поповер,
 *   автофокус контента отключён (emoji-панель #130 — «попап не крадёт фокус
 *   композера»), фокус остаётся на триггере; steal кадром позже уводил его
 *   в композер → DismissableLayer закрывал панель по focusOutside мгновенно
 *   (#132 р.5 «панель эмодзи закрывается сразу после открытия»);
 * - фокус возвращается с preventScroll — лента не прыгает при возврате;
 * - анрегистр активного композера (закрыли тред) передаёт курсор ранее
 *  зарегистрированному (ленте канала) — «закрыл тред → мигает канал».
 */
const registry = new Map<string, CaretOwner>();
/** Владелец каретки — многострочный композер или однострочное поле поиска:
 *  механизм «вечного курсора» общий (см. §«Фокус ПЕРЕДАЁТСЯ» выше). */
type CaretOwner = HTMLTextAreaElement | HTMLInputElement;
let activeId: string | null = null;
let modality: 'pointer' | 'key' | 'other' = 'other';
/** ЛКМ зажата (между pointerdown и pointerup/cancel) — фокус не крадём:
 *  идёт клик ИЛИ зарождающееся выделение текста (#132 р.4). */
let pointerHeld = false;
let installed = false;

/** Роли Radix-контента оверлей-слоёв (dialog/popover → role=dialog,
 *  dropdown/context-menu → role=menu, select → role=listbox; DOM-проба #71). */
const OVERLAY_LAYER_ROLES = new Set(['dialog', 'alertdialog', 'menu', 'listbox']);

function isEditable(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  );
}

/** Диагностика «супер-курсора» (#104 раунд 2): при ?wsdebug=1 каждый ранний
 *  выход stealFocus объясняет себя — застрявший гард виден в console сразу. */
function debugSkip(guard: string): void {
  if (!wsDebugEnabled) return;
  const selection = window.getSelection();
  // warn — канон no-console (log запрещён); вывод только под ?wsdebug=1.
  console.warn(
    '[ws] stealFocus skip:',
    guard,
    '| activeElement:',
    document.activeElement?.constructor.name,
    document.activeElement?.tagName,
    document.activeElement?.getAttribute?.('data-slot') ?? '',
    '| selection collapsed:',
    selection?.isCollapsed ?? 'n/a',
    '| modality:',
    modality,
  );
}

/**
 * Активный элемент живёт в открытом оверлей-слое (диалог, поповер, меню,
 * селект), который владеет фокусом, пока слой открыт (#71: иначе
 * DismissableLayer закроет панель по focusOutside). Слои-ПРЕДКИ, содержащие
 * сам композер, слоем НЕ считаются (вердикт 25.09): карточка-слайдер — тоже
 * role="dialog", но это ПОСТОЯННОЕ вместилище чата, а не всплывающий слой —
 * её «владение» фокусом никогда не кончается, и без этой поправки возврат
 * курсора в композер слайдера («Ответить»/«Редактировать», обычные клики)
 * блокировался навсегда. Проверяется вся цепочка предков: первый слой,
 * НЕ содержащий композер, — конкурирующий владелец (портал Radix поверх
 * слайдера, диалог поверх страницы).
 */
function insideOverlayLayer(el: Element | null, composer: Element | null = null): boolean {
  // Поверхность-владелец: диалог, в котором живёт поле. Слои ВНУТРИ неё —
  // часть той же поверхности, а не конкурирующий оверлей: список выдачи cmdk
  // сам role="listbox" (иначе клик по пустому месту списка «убивал» каретку
  // поиска, #952). Чужие поповеры/меню Radix портируются в body — вне этой
  // поверхности — и по-прежнему владеют фокусом.
  const ownerSurface = composer?.closest('[role="dialog"]') ?? null;
  let node: Element | null = el;
  while (node instanceof Element) {
    if (node.hasAttribute('role') && OVERLAY_LAYER_ROLES.has(node.getAttribute('role') ?? '')) {
      const ownLayer = composer !== null && node.contains(composer);
      const sameSurface = ownerSurface !== null && ownerSurface.contains(node);
      if (!ownLayer && !sameSurface) return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** Активный элемент — ТРИГГЕР открытого слоя Radix (aria-expanded=true,
 *  aria-controls указывает на смонтированный контент): слой владеет фокусом
 *  и через триггер (#132 р.5 — фокус-кража закрывала панель эмодзи по
 *  focusOutside в кадр после клика). Закрытый слой триггером не считается
 *  (контент размонтирован) — возврат курсора после закрытия как раньше. */
function isOpenLayerTrigger(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const trigger = el.closest<HTMLElement>('[aria-expanded="true"]');
  if (!trigger) return false;
  const contentId = trigger.getAttribute('aria-controls');
  if (!contentId) return false;
  return document.getElementById(contentId) !== null;
}

function stealFocus(): void {
  const el = activeId ? registry.get(activeId) : undefined;
  if (!el || document.activeElement === el) {
    if (!el) debugSkip('no-active-composer');
    return;
  }
  if (isEditable(document.activeElement)) {
    debugSkip('editable-active-element');
    return;
  }
  // Нативные контролы медиа (#250): клик по «трём точкам»/ползунку отдаёт
  // фокус <video>, и кража курсора закрывала бы нативное меню сразу после
  // открытия. Пока фокус на медиаэлементе, композер ждёт.
  if (document.activeElement instanceof HTMLMediaElement) {
    debugSkip('media-active-element');
    return;
  }
  // Окно отправки вложений (#144): пока открыто, каретка принадлежит подписи
  // окна — композер не крадёт её ни на кликах по строкам, ни на drag (drop
  // оставляет focus на ручке drag, и без гарда курсор уезжал в композер).
  if (useAttachSendDialog.getState().scope) {
    debugSkip('attach-send-dialog-open');
    return;
  }
  if (insideOverlayLayer(document.activeElement, el)) {
    debugSkip('overlay-layer');
    return;
  }
  if (isOpenLayerTrigger(document.activeElement)) {
    debugSkip('open-layer-trigger');
    return;
  }
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    debugSkip('text-selection');
    return;
  }
  el.focus({ preventScroll: true });
}

function install(): void {
  installed = true;
  // Модальность ввода: возвращаем фокус ТОЛЬКО после мышиных кликов левой
  // кнопкой (правая — контекстное меню Radix: его фокус не трогаем).
  document.addEventListener(
    'pointerdown',
    (e) => {
      modality = e.button === 0 ? 'pointer' : 'other';
      pointerHeld = e.button === 0;
    },
    true,
  );
  document.addEventListener(
    'pointerup',
    () => {
      pointerHeld = false;
    },
    true,
  );
  document.addEventListener(
    'pointercancel',
    () => {
      pointerHeld = false;
    },
    true,
  );
  document.addEventListener(
    'keydown',
    () => {
      modality = 'key';
    },
    true,
  );
  document.addEventListener('focusin', (e) => {
    const target = e.target as Element | null;
    if (isEditable(target)) {
      for (const [id, el] of registry) {
        if (el === target) activeId = id;
      }
      return;
    }
    if (modality !== 'pointer') return;
    // #132 р.4: пока ЛКМ ЗАЖАТА — не крадём: фокус уходит кликабельному
    // контейнеру (скроллер ленты, tabIndex) на mousedown, steal кадром
    // позже видел СВЁРНУТУЮ селекцию и textarea.focus() убивал зарождающееся
    // выделение текста (текст/цитаты были мертвы). Для кликов каретку
    // возвращает click-обработчик ниже (после mouseup, с гардом готовой
    // селекции); эта ветка — для фокусов БЕЗ зажатой кнопки (Radix
    // onCloseAutoFocus после закрытия оверлей-слоя — канон сохранён).
    if (pointerHeld) return;
    if (target instanceof HTMLElement && (target.closest('button') || target.tabIndex >= 0)) {
      requestAnimationFrame(stealFocus);
    }
  });
  document.addEventListener('click', () => {
    if (modality !== 'pointer') return;
    // click приходит ПОСЛЕ mouseup: если пользователь тянул выделение текста,
    // селекция несвёрнута — stealFocus её уважит и не тронет фокус.
    requestAnimationFrame(stealFocus);
  });
}

/** Композер монтируется: становится активным владельцем курсора и ЗАБИРАЕТ
 *  его сразу (autoFocus в commit-фазе переживает StrictMode-цикл
 *  mount→cleanup→mount только вместе с этим фокусом: cleanup промежуточной
 *  итерации возвращает курсор ранее зарегистрированному, повторный register
 *  без focus оставил бы курсор не там — трассировка focus/focusin, 14.09.2026). */
export function registerComposer(id: string, el: CaretOwner): void {
  registry.set(id, el);
  activeId = id;
  if (!installed) install();
  el.focus({ preventScroll: true });
}

/** Композер размонтируется; активный передаёт курсор следующему по регистрации. */
export function unregisterComposer(id: string, el: CaretOwner): void {
  if (registry.get(id) !== el) return;
  registry.delete(id);
  if (activeId !== id) return;
  activeId = registry.keys().next().value ?? null;
  const next = activeId ? registry.get(activeId) : undefined;
  if (next) next.focus({ preventScroll: true });
}

/** Явная передача курсора конкретному композеру (действия «Ответить»/
 *  «Редактировать» из контекстного меню — канон Telegram: фокус в поле). */
export function focusComposer(id: string): void {
  registry.get(id)?.focus({ preventScroll: true });
}

/** Композер scope смонтирован И ВИДЕН (вердикт 25.09: фокус/действия «за
 *  спиной» накрытых карточек запрещены — dormant-карточка под слайдером
 *  держит композер в DOM, но content-visibility:hidden выводит его из
 *  рендеринга; checkVisibility() это видит, старые движки — fallback «виден»). */
export function hasVisibleComposer(id: string): boolean {
  const el = registry.get(id);
  if (!el) return false;
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}

/** Курсор в композер БЕСЕДЫ после закрытия глобальных диалогов (пересылка,
 *  удаление, откреп — баг #91): диалог не знает scope ленты (feed/Conversation),
 *  пробуем оба ключа зарегистрированных композеров беседы. */
export function focusConversationComposerWhenFree(conversationId: string, deadlineMs = 600): void {
  for (const key of [`conversation:${conversationId}`, `feed:${conversationId}`]) {
    if (registry.has(key)) {
      focusComposerWhenFree(key, deadlineMs);
      return;
    }
  }
}

/** Фокус в композер ПОСЛЕ закрытия оверлей-слоя (пункты контекстного меню
 *  «Ответить»/«Редактировать»): Radix возвращает фокус триггеру на размонтаже
 *  контента (после exit-анимации) — немедленный focus перетирается (баг-
 *  вердикт 24.09: «после Редактировать курсор не в поле»). Ждём кадров, пока
 *  activeElement вне редактируемых и вне оверлей-слоёв, тогда фокусим.
 *  ЗАРЕГИСТРИРОВАННЫЙ композер — уже «свободно» (#1072): передача курсора
 *  между композерами — штатный ручной путь канона («фокус передаётся
 *  вручную другому композеру»); раньше язычок «Ответить» в треде держал
 *  preventDefault (каретку не дёргать, #71) и активным оставался композер
 *  ленты канала — ожидание «не-editable» истекало и курсор не переезжал.
 *  Чужие редактируемые поля (подпись окна вложений, переименование файла)
 *  ожидание держат как раньше. Постоянные вместилища композера (карточка-
 *  слайдер, role="dialog") ожидание не держат — см. insideOverlayLayer
 *  (вердикт 25.09). */
export function focusComposerWhenFree(id: string, deadlineMs = 600): void {
  const started = performance.now();
  function tick() {
    const el = registry.get(id);
    if (!el || document.activeElement === el) return;
    const active = document.activeElement;
    const foreignEditable = isEditable(active) && !isRegisteredComposer(active);
    if (foreignEditable || insideOverlayLayer(active, el)) {
      if (performance.now() - started < deadlineMs) requestAnimationFrame(tick);
      return;
    }
    el.focus({ preventScroll: true });
  }
  requestAnimationFrame(tick);
}

/** Элемент — один из зарегистрированных композеров реестра. */
function isRegisteredComposer(el: Element | null): boolean {
  for (const item of registry.values()) {
    if (item === el) return true;
  }
  return false;
}
