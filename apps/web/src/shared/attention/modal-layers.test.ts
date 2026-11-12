// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isModalLayerOpen,
  registerModalLayer,
  resetModalLayersForTests,
  startModalLayerTracking,
  subscribeModalLayers,
} from './modal-layers.js';

/**
 * Реестр модальных слоёв (#809): Radix-диалоги и полноэкранные порталы
 * перекрывают поверхность; карточка-поверхность (`data-card-surface`) — нет;
 * мелкие поповеры в селектор не входят.
 */

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetModalLayersForTests();
});

afterEach(() => {
  resetModalLayersForTests();
  document.body.innerHTML = '';
});

describe('modal-layers', () => {
  it('регистрация/освобождение слоя переключает признак и уведомляет подписчиков', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeModalLayers(listener);
    const element = document.createElement('div');
    const release = registerModalLayer(element);
    expect(isModalLayerOpen()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    // Повторная регистрация ТОГО ЖЕ элемента — не второй слой (Set, а не
    // счётчик): StrictMode-двойной эффект не даёт ложного «закрыто».
    const releaseAgain = registerModalLayer(element);
    expect(listener).toHaveBeenCalledTimes(1);
    release();
    expect(isModalLayerOpen()).toBe(false);
    releaseAgain();
    expect(isModalLayerOpen()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('DOM-трекер видит Radix-диалог и полноэкранный aria-modal портал', async () => {
    const stop = startModalLayerTracking();
    expect(isModalLayerOpen()).toBe(false);

    const dialog = document.createElement('div');
    dialog.setAttribute('data-slot', 'dialog-content');
    document.body.append(dialog);
    await tick();
    expect(isModalLayerOpen()).toBe(true);

    const lightbox = document.createElement('div');
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    document.body.append(lightbox);
    await tick();
    expect(isModalLayerOpen()).toBe(true);

    dialog.remove();
    expect(isModalLayerOpen()).toBe(true); // второй слой ещё открыт
    lightbox.remove();
    await tick();
    expect(isModalLayerOpen()).toBe(false);
    stop();
  });

  it('карточка-поверхность (data-card-surface) слоем не считается', async () => {
    const stop = startModalLayerTracking();
    const card = document.createElement('section');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('data-card-surface', '');
    document.body.append(card);
    await tick();
    expect(isModalLayerOpen()).toBe(false);
    stop();
  });

  it('мелкие поповеры (меню/тултипы) в реестр не попадают', async () => {
    const stop = startModalLayerTracking();
    const menu = document.createElement('div');
    menu.setAttribute('data-slot', 'dropdown-menu-content');
    menu.setAttribute('role', 'menu');
    document.body.append(menu);
    await tick();
    expect(isModalLayerOpen()).toBe(false);
    stop();
  });
});
