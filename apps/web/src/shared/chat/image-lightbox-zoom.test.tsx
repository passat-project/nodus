// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MessageAttachment } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { ImageLightbox } from './image-lightbox.js';

/**
 * Зум в лайтбоксе галереи чата (#721): та же панель, что у вложений,
 * «100% = натуральные пиксели», вписывание — 85% экрана. Стрелки делят две
 * роли: фокус в области просмотра И картинка больше окна — панорама, иначе
 * листание. Esc и клик по заднику закрывают как раньше, но задник закрывает
 * с паузой: двойной клик переключает масштаб, а не выбрасывает из просмотра.
 *
 * jsdom не грузит картинки и не меряет боксы: окно 1000×800, натуральный
 * размер 800×800 → вписывание 85% (0.85 от 800), при 125% картинка выше окна
 * и её можно двигать (bounds.y = 100).
 */

const VIEWPORT = { width: 1000, height: 800 };
const NATURAL = { width: 800, height: 800 };

let restore: Array<() => void> = [];

function stub(target: object, property: string, value: number) {
  const original = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, { configurable: true, get: () => value });
  restore.push(() => {
    if (original) Object.defineProperty(target, property, original);
    else delete (target as Record<string, unknown>)[property];
  });
}

beforeAll(() => {
  stub(Element.prototype, 'clientWidth', VIEWPORT.width);
  stub(Element.prototype, 'clientHeight', VIEWPORT.height);
  stub(HTMLImageElement.prototype, 'naturalWidth', NATURAL.width);
  stub(HTMLImageElement.prototype, 'naturalHeight', NATURAL.height);
});

afterAll(() => {
  for (const undo of restore) undo();
  restore = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const image = (id: string): MessageAttachment => ({
  id,
  fileId: `00000000-0000-4000-8000-00000000000${id}`,
  name: `${id}.png`,
  size: 1000,
  mime: 'image/png',
  kind: 'image',
  url: `/demo/${id}.png`,
  thumbnailUrl: `/demo/${id}.png`,
  previewKind: 'image',
  pdfUrl: null,
  width: NATURAL.width,
  height: NATURAL.height,
});

function renderLightbox({ images = [image('1'), image('2')], index = 0 } = {}) {
  const onIndex = vi.fn();
  const onClose = vi.fn();
  render(<ImageLightbox images={images} index={index} onIndex={onIndex} onClose={onClose} />);
  fireEvent.load(screen.getByRole('img'));
  return { onIndex, onClose };
}

const area = () => screen.getByRole('group', { name: ui.files.imageArea });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const percent = () => screen.getByText(/^\d+%$/).textContent;
const box = () => screen.getByRole('img').parentElement as HTMLElement;

/** Протяжка мышью по области: pointerdown → pointermove (bubbles до области). */
function drag(target: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent(
    target,
    new MouseEvent('pointerdown', { bubbles: true, clientX: from[0], clientY: from[1] }),
  );
  fireEvent(
    target,
    new MouseEvent('pointermove', { bubbles: true, clientX: to[0], clientY: to[1] }),
  );
  fireEvent(target, new MouseEvent('pointerup', { bubbles: true, clientX: to[0], clientY: to[1] }));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('ImageLightbox: масштаб', () => {
  it('открывается «по размеру экрана» и меняет процент кнопками', () => {
    const { onClose } = renderLightbox();
    expect(screen.getByRole('toolbar', { name: ui.files.zoomPanel })).toBeTruthy();
    expect(percent()).toBe('85%');
    fireEvent.click(button(ui.files.zoomIn));
    expect(percent()).toBe('100%');
    fireEvent.click(button(ui.files.zoomOut));
    expect(percent()).toBe('75%');
    fireEvent.click(button(ui.files.zoomFit));
    expect(percent()).toBe('85%');
    // Панель масштаба — не задник: лайтбокс от клика по ней не закрывается.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('счётчик галереи остаётся в верхней полосе', () => {
    renderLightbox();
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('полоса и кнопки — отдельный слой над кадром при увеличении', () => {
    renderLightbox();
    fireEvent.click(button(ui.files.zoomIn));
    fireEvent.click(button(ui.files.zoomIn));
    expect(percent()).toBe('125%');

    const toolbar = screen.getByRole('toolbar', { name: ui.files.zoomPanel });
    const layer = toolbar.parentElement as HTMLElement;
    const viewport = area();
    // Полоса не внутри кадра: overflow и пан кадра её не режут и не сдвигают.
    expect(viewport.contains(toolbar)).toBe(false);
    // Слои сравнимы: хром z-20 против кадра z-0 в одном контейнере.
    expect(layer.parentElement).toBe(viewport.parentElement);
    expect(layer.className).toContain('z-20');
    expect(layer.className).toContain('absolute');
    expect(viewport.className).toContain('z-0');
    // Подложка сплошная (не градиент) — полоса читается на светлом фото.
    expect(toolbar.className).toContain('bg-black/60');
    expect(toolbar.className).toContain('backdrop-blur-sm');
    expect(toolbar.className).not.toContain('bg-card');
    expect(toolbar.className).toContain('text-white/90');
    // Правая группа не наезжает на крестик: у полосы место под него.
    expect(toolbar.className).toContain('pr-12');
    expect(screen.getByRole('button', { name: ui.common.close }).className).toContain('z-20');
  });

  it('смена кадра сбрасывает зум к вписыванию', () => {
    const { onIndex } = renderLightbox();
    fireEvent.click(button(ui.files.zoomIn));
    expect(percent()).toBe('100%');
    fireEvent.click(button(ui.chat.photoNext));
    expect(onIndex).toHaveBeenCalledWith(1);
  });
});

describe('ImageLightbox: двойной клик и закрытие по заднику', () => {
  it('двойной клик переключает масштаб и НЕ закрывает просмотр', () => {
    const { onClose } = renderLightbox();
    vi.useFakeTimers();
    // Браузерная последовательность: клик (detail 1), клик (detail 2), dblclick.
    fireEvent.click(area(), { detail: 1 });
    fireEvent.click(area(), { detail: 2 });
    fireEvent.dblClick(area());
    expect(percent()).toBe('100%');
    advance(1000);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('одиночный клик по заднику закрывает — с паузой под двойной клик', () => {
    const { onClose } = renderLightbox();
    vi.useFakeTimers();
    fireEvent.click(area(), { detail: 1 });
    expect(onClose).not.toHaveBeenCalled();
    advance(1000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('клик по самому фото не закрывает (даже после переадресации клика области)', () => {
    const { onClose } = renderLightbox();
    vi.useFakeTimers();
    // pointer capture области переадресует click ей же — нажатие распознаём
    // на pointerdown по цели.
    fireEvent(screen.getByRole('img'), new MouseEvent('pointerdown', { bubbles: true }));
    fireEvent.click(area(), { detail: 1 });
    advance(1000);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Esc по-прежнему закрывает', () => {
    const { onClose } = renderLightbox();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ImageLightbox: панорамирование', () => {
  it('картинка не перетаскивается нативно — жест остаётся панораме', () => {
    renderLightbox();
    expect(screen.getByRole('img').getAttribute('draggable')).toBe('false');
  });

  it('перетаскивание сдвигает картинку при увеличении', () => {
    renderLightbox();
    fireEvent.click(button(ui.files.zoomIn));
    fireEvent.click(button(ui.files.zoomIn));
    expect(percent()).toBe('125%');
    expect(box().style.transform).toBe('translate(0px, 0px)');

    drag(area(), [500, 400], [500, 300]);
    expect(box().style.transform).toBe('translate(0px, -100px)');
  });

  it('при вписывании (100% и меньше) панорамы нет — сдвиг не накапливается', () => {
    renderLightbox();
    expect(percent()).toBe('85%');
    drag(area(), [500, 400], [500, 100]);
    expect(box().style.transform).toBe('translate(0px, 0px)');
  });
});

describe('ImageLightbox: клавиши', () => {
  it('«по размеру» стрелки листают галерею', () => {
    const { onIndex } = renderLightbox();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onIndex).toHaveBeenCalledWith(1);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onIndex).toHaveBeenCalledWith(0);
  });

  it('картинка больше окна и фокус в области — стрелки панораме, не листанию', () => {
    const { onIndex } = renderLightbox();
    fireEvent.click(button(ui.files.zoomIn));
    fireEvent.click(button(ui.files.zoomIn));
    expect(percent()).toBe('125%');
    area().focus();
    fireEvent.keyDown(area(), { key: 'ArrowRight' });
    expect(onIndex).not.toHaveBeenCalled();
  });

  it('без фокуса в области клавиши масштаба не перехватываются', () => {
    renderLightbox();
    fireEvent.keyDown(document.body, { key: '+' });
    expect(percent()).toBe('85%');
    area().focus();
    fireEvent.keyDown(area(), { key: '+' });
    expect(percent()).toBe('100%');
    fireEvent.keyDown(area(), { key: '0' });
    expect(percent()).toBe('85%');
  });
});
