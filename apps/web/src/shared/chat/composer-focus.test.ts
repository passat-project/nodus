// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { focusComposerWhenFree, registerComposer, unregisterComposer } from './composer-focus.js';

/** Кадр rAF — именно в нём stealFocus исполняется после focusin/click. */
function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Левый pointerdown ставит модальность «pointer» (условие возврата курсора). */
function leftPointerDown(): void {
  document.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
}

/** pointerup — кнопка отпущена (#132 р.4: пока ЛКМ зажата, фокус не крадётся). */
function pointerUp(): void {
  document.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }));
}

/** Честный клик: down → фокус цели → up → click (возврат каретки — по click). */
function leftClick(target: HTMLElement): void {
  leftPointerDown();
  target.focus();
  pointerUp();
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('composer-focus — «вечный курсор» и оверлей-слои (регрессия #71)', () => {
  let composer: HTMLTextAreaElement;

  beforeEach(() => {
    composer = document.createElement('textarea');
    document.body.append(composer);
    registerComposer('test-composer', composer);
  });

  afterEach(() => {
    unregisterComposer('test-composer', composer);
    composer.remove();
    document.body.innerHTML = '';
  });

  it('нативные контролы видео: фокус на <video> не крадётся (меню не закрывается, #250)', async () => {
    const video = document.createElement('video');
    video.tabIndex = 0;
    document.body.append(video);
    leftClick(video);
    await frame();
    expect(document.activeElement).toBe(video);
  });

  it('клик по кнопке ВНЕ слоя — курсор возвращается в композер (канон)', async () => {
    const btn = document.createElement('button');
    document.body.append(btn);
    leftClick(btn);
    await frame();
    expect(document.activeElement).toBe(composer);
  });

  it('поле поиска (input) — такой же владелец каретки: клик по фильтру её возвращает', async () => {
    // Строка поиска регистрируется тем же механизмом (#952): клик по панели
    // фильтров не должен «убивать» каретку — продолжаем печатать.
    const layer = document.createElement('div');
    layer.setAttribute('role', 'dialog');
    const input = document.createElement('input');
    const filter = document.createElement('button');
    layer.append(input, filter);
    document.body.append(layer);
    registerComposer('search-probe', input);
    leftClick(filter);
    await frame();
    expect(document.activeElement).toBe(input);
    unregisterComposer('search-probe', input);
  });

  it('role=listbox ВНУТРИ диалога-владельца — не чужой слой (список выдачи поиска)', async () => {
    // CommandList (cmdk) сам role="listbox": клик по пустому месту списка
    // не должен считаться «фокусом в чужом оверлее» (#952).
    const layer = document.createElement('div');
    layer.setAttribute('role', 'dialog');
    const input = document.createElement('input');
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    list.tabIndex = 0;
    layer.append(input, list);
    document.body.append(layer);
    registerComposer('search-probe-list', input);
    leftClick(list);
    await frame();
    expect(document.activeElement).toBe(input);
    unregisterComposer('search-probe-list', input);
  });

  it('ПОКА ЛКМ зажата — фокус не крадётся (нативное выделение текста живо, #132 р.4)', async () => {
    // mousedown на тексте ленты: фокус ушёл скроллеру (tabIndex) — steal
    // кадром позже убивал зарождающийся драг-селект; теперь ждём отпускания.
    const scroller = document.createElement('div');
    scroller.tabIndex = 0;
    document.body.append(scroller);
    leftPointerDown();
    scroller.focus();
    await frame();
    expect(document.activeElement).toBe(scroller);
    pointerUp();
    scroller.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await frame();
    expect(document.activeElement).toBe(composer);
  });

  it.each(['dialog', 'alertdialog', 'menu', 'listbox'])(
    'фокус внутри role=%s — НЕ крадётся (иначе DismissableLayer закроет панель по focusOutside)',
    async (role) => {
      const layer = document.createElement('div');
      layer.setAttribute('role', role);
      const btn = document.createElement('button');
      layer.append(btn);
      document.body.append(layer);
      leftPointerDown();
      btn.focus();
      await frame();
      expect(document.activeElement).toBe(btn);
    },
  );

  it('bubbling-click при фокусе внутри слоя — тоже не крадёт', async () => {
    const layer = document.createElement('div');
    layer.setAttribute('role', 'dialog');
    const btn = document.createElement('button');
    layer.append(btn);
    document.body.append(layer);
    leftPointerDown();
    btn.focus();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await frame();
    expect(document.activeElement).toBe(btn);
  });

  it('клик открыл поповер, фокус на ТРИГГЕРЕ — не крадётся (emoji-панель жива, #132 р.5)', async () => {
    // Как PopoverTrigger Radix при открытой панели эмодзи (#130): триггер
    // несёт aria-expanded=true + aria-controls на СМОНТИРОВАННЫЙ контент,
    // автофокус контента отключён — фокус остаётся на триггере. Кража кадром
    // позже уводила его в композер → DismissableLayer закрывал панель
    // по focusOutside мгновенно.
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', 'emoji-panel-content');
    const content = document.createElement('div');
    content.id = 'emoji-panel-content';
    content.setAttribute('role', 'dialog');
    document.body.append(trigger, content);
    try {
      leftClick(trigger);
      await frame();
      expect(document.activeElement).toBe(trigger);
    } finally {
      trigger.remove();
      content.remove();
    }
  });

  it('закрытый слой (контент размонтирован) — триггер обычная кнопка, курсор возвращается', async () => {
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'gone-panel-content');
    document.body.append(trigger);
    try {
      leftClick(trigger);
      await frame();
      expect(document.activeElement).toBe(composer);
    } finally {
      trigger.remove();
    }
  });

  it('слой закрылся, фокус на триггере — курсор возвращается (канон сохранён)', async () => {
    const layer = document.createElement('div');
    layer.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    layer.append(inner);
    document.body.append(layer);
    const trigger = document.createElement('button');
    document.body.append(trigger);

    leftPointerDown();
    inner.focus();
    await frame();
    expect(document.activeElement).toBe(inner);
    pointerUp(); // слой закрывается уже без зажатой кнопки

    // «Закрытие поповера»: Radix возвращает фокус на триггер (onCloseAutoFocus).
    layer.remove();
    trigger.focus();
    await frame();
    expect(document.activeElement).toBe(composer);
  });

  it('клавиатурный фокус (без pointerdown) — не крадётся (канон модальности)', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    const btn = document.createElement('button');
    document.body.append(btn);
    btn.focus();
    await frame();
    expect(document.activeElement).toBe(btn);
  });

  it('карточка-слайдер (role=dialog) содержит композер — НЕ блокирует возврат курсора', async () => {
    // Слайдер — постоянное вместилище чата (вердикт 25.09): его role="dialog"
    // не «владеет» фокусом, курсор возвращается кликом в композер слайдера.
    const slider = document.createElement('section');
    slider.setAttribute('role', 'dialog');
    const sliderComposer = document.createElement('textarea');
    const railButton = document.createElement('button');
    slider.append(railButton, sliderComposer);
    document.body.append(slider);
    registerComposer('slider-composer', sliderComposer);
    try {
      leftClick(railButton);
      await frame();
      expect(document.activeElement).toBe(sliderComposer);
    } finally {
      unregisterComposer('slider-composer', sliderComposer);
      slider.remove();
    }
  });

  it('focusComposerWhenFree: курсор в композер слайдера, пока activeElement внутри её же role=dialog', async () => {
    const slider = document.createElement('section');
    slider.setAttribute('role', 'dialog');
    const sliderComposer = document.createElement('textarea');
    const messageButton = document.createElement('button');
    slider.append(messageButton, sliderComposer);
    document.body.append(slider);
    registerComposer('slider-composer-free', sliderComposer);
    messageButton.focus(); // как после закрытия контекстного меню
    try {
      focusComposerWhenFree('slider-composer-free', 300);
      await frame();
      expect(document.activeElement).toBe(sliderComposer);
    } finally {
      unregisterComposer('slider-composer-free', sliderComposer);
      slider.remove();
    }
  });

  it('чужой оверлей (role=menu портала, композер не внутри) по-прежнему держит фокус (#71)', async () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1; // как Radix menuitem: фокусируемый, но не в tab-order
    menu.append(item);
    document.body.append(menu);
    leftPointerDown();
    item.focus();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    try {
      await frame();
      // Слой открыт — фокус не крадётся, композер ждёт.
      expect(document.activeElement).toBe(item);
      pointerUp(); // дальше — закрытие слоя без зажатой кнопки
      // Слой закрылся: Radix возвращает фокус триггеру — курсор возвращается
      // в композер (канон сохранён).
      menu.remove();
      trigger.focus();
      await frame();
      expect(document.activeElement).toBe(composer);
    } finally {
      menu.remove();
      trigger.remove();
    }
  });

  it('focusComposerWhenFree дожидается закрытия чужого слоя, затем фокусит', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    dialog.append(inner);
    document.body.append(dialog);
    inner.focus();
    focusComposerWhenFree('test-composer', 300);
    await frame();
    expect(document.activeElement).toBe(inner); // ещё ждём
    dialog.remove();
    await frame();
    expect(document.activeElement).toBe(composer);
  });
});
