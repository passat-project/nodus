// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ui } from '@nodus/contracts';

import { ImageViewer } from './image-viewer.js';
import { MediaViewer } from './media-viewer.js';

/**
 * Просмотр изображений с зумом (#721): панель масштаба (общая с PDF),
 * клавиши при фокусе, двойной клик и кламп панорамы. jsdom не грузит
 * картинки и не меряет боксы — размеры окна и натуральный размер подменены
 * ровно на те, что нужны геометрии (800×600 окно, 1600×1200 картинка:
 * вписывание = 50%, потолок панорамы при 200% = 1200×900).
 */

const VIEWPORT = { width: 800, height: 600 };
const IMAGE = { width: 1600, height: 1200 };

let restore: Array<() => void> = [];

function stub(target: object, property: string, value: number) {
  const original = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, {
    configurable: true,
    get: () => value,
  });
  restore.push(() => {
    if (original) Object.defineProperty(target, property, original);
    else delete (target as Record<string, unknown>)[property];
  });
}

beforeAll(() => {
  stub(Element.prototype, 'clientWidth', VIEWPORT.width);
  stub(Element.prototype, 'clientHeight', VIEWPORT.height);
  stub(HTMLImageElement.prototype, 'naturalWidth', IMAGE.width);
  stub(HTMLImageElement.prototype, 'naturalHeight', IMAGE.height);
});

afterAll(() => {
  for (const undo of restore) undo();
  restore = [];
});

afterEach(cleanup);

/** Картинка «загрузилась»: натуральный размер приходит только по onLoad. */
function renderImage() {
  const view = render(<ImageViewer url="/files/scan.png" name="scan.png" />);
  fireEvent.load(screen.getByRole('img'));
  return view;
}

const area = () => screen.getByRole('group', { name: ui.files.imageArea });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const percent = () => screen.getByText(/^\d+%$/).textContent;

describe('ImageViewer: панель масштаба', () => {
  it('открывается «по размеру окна» с процентом вписывания', () => {
    renderImage();
    expect(screen.getByRole('toolbar', { name: ui.files.zoomPanel })).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('кнопки «+»/«−» меняют процент по остановкам', () => {
    renderImage();
    fireEvent.click(button(ui.files.zoomIn));
    expect(percent()).toBe('75%');
    fireEvent.click(button(ui.files.zoomIn));
    expect(percent()).toBe('100%');
    fireEvent.click(button(ui.files.zoomOut));
    expect(percent()).toBe('75%');
  });

  it('на пределе 25% «−» гаснет, на 400% гаснет «+»', () => {
    renderImage();
    const out = button(ui.files.zoomOut);
    for (let i = 0; i < 8; i += 1) fireEvent.click(out);
    expect(percent()).toBe('25%');
    expect(out.disabled).toBe(true);

    const plus = button(ui.files.zoomIn);
    for (let i = 0; i < 10; i += 1) fireEvent.click(plus);
    expect(percent()).toBe('400%');
    expect(plus.disabled).toBe(true);
  });

  it('сброс «по размеру окна» возвращает вписывание', () => {
    renderImage();
    fireEvent.click(button(ui.files.zoomIn));
    fireEvent.click(button(ui.files.zoomFit));
    expect(percent()).toBe('50%');
  });

  it('панель — отдельный слой над областью кадра, а не под ней', () => {
    renderImage();
    fireEvent.click(button(ui.files.zoomIn));
    fireEvent.click(button(ui.files.zoomIn));
    const toolbar = screen.getByRole('toolbar', { name: ui.files.zoomPanel });
    const area = screen.getByRole('group', { name: ui.files.imageArea });
    expect(area.contains(toolbar)).toBe(false);
    expect(toolbar.className).toContain('z-10');
    // Своя подложка панели: читаемость не зависит от того, что за ней
    // (светлая картинка под панелью больше не «съедает» контролы).
    expect(toolbar.className).toContain('bg-card');
    expect(area.className).toContain('z-0');
    // Область занимает остаток под панелью (не полную высоту хоста),
    // иначе кадр вылезал за низ на высоту панели.
    expect(area.className).toContain('flex-1');
    expect(area.className).not.toContain('size-full');
  });
});

describe('ImageViewer: колесо и клавиатура', () => {
  it('Ctrl+колесо меняет масштаб, колесо без модификатора — нет', () => {
    renderImage();
    fireEvent.wheel(area(), { deltaY: 100 });
    expect(percent()).toBe('50%');
    fireEvent.wheel(area(), { deltaY: -100, ctrlKey: true });
    expect(percent()).not.toBe('50%');
  });

  it('«+», «−», «0» работают при фокусе в области', () => {
    renderImage();
    area().focus();
    fireEvent.keyDown(area(), { key: '+' });
    expect(percent()).toBe('75%');
    fireEvent.keyDown(area(), { key: '-' });
    expect(percent()).toBe('50%');
    fireEvent.keyDown(area(), { key: '+' });
    fireEvent.keyDown(area(), { key: '0' });
    expect(percent()).toBe('50%');
  });

  it('вне фокуса просмотрщика клавиши не перехватываются', () => {
    renderImage();
    fireEvent.keyDown(document.body, { key: '+' });
    expect(percent()).toBe('50%');
  });
});

describe('ImageViewer: двойной клик и панорама', () => {
  it('двойной клик переключает «по размеру» ↔ 100%', () => {
    renderImage();
    fireEvent.doubleClick(area());
    expect(percent()).toBe('100%');
    fireEvent.doubleClick(area());
    expect(percent()).toBe('50%');
  });

  it('перетаскивание сдвигает картинку и клампится по краю', () => {
    renderImage();
    fireEvent.doubleClick(area());
    fireEvent.click(button(ui.files.zoomIn));
    fireEvent.click(button(ui.files.zoomIn));
    fireEvent.click(button(ui.files.zoomIn));
    expect(percent()).toBe('200%');

    const image = screen.getByRole('img');
    fireEvent(area(), new MouseEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 300 }));
    fireEvent(area(), new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 300 }));
    expect(image.style.transform).toContain('-100px');

    fireEvent(
      area(),
      new MouseEvent('pointermove', { bubbles: true, clientX: -10000, clientY: 300 }),
    );
    expect(image.style.transform).toContain('-1200px');
    fireEvent(
      area(),
      new MouseEvent('pointerup', { bubbles: true, clientX: -10000, clientY: 300 }),
    );
  });
});

describe('MediaViewer: панель только у изображений', () => {
  it('изображение получает панель масштаба', () => {
    render(<MediaViewer url="/files/a.png" mime="image/png" name="a.png" />);
    expect(screen.getByRole('toolbar', { name: ui.files.zoomPanel })).toBeTruthy();
  });

  it('скан письма (fit="width") тоже с панелью', () => {
    render(<MediaViewer url="/files/scan.png" mime="image/png" name="scan.png" fit="width" />);
    expect(screen.getByRole('toolbar', { name: ui.files.zoomPanel })).toBeTruthy();
    fireEvent.load(screen.getByRole('img'));
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it.each([
    ['audio/mpeg', 'a.mp3'],
    ['video/mp4', 'a.mp4'],
  ])('у %s панели нет', (mime, name) => {
    render(<MediaViewer url={`/files/${name}`} mime={mime} name={name} />);
    expect(screen.queryByRole('toolbar', { name: ui.files.zoomPanel })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.files.zoomIn })).toBeNull();
  });
});
