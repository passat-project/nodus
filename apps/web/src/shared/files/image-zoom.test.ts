import { describe, expect, it } from 'vitest';

import {
  clampPan,
  clampZoom,
  fitZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoom,
  panBounds,
  prevZoom,
  toggleZoom,
  wheelZoom,
  widthFitZoom,
  zoomAtPoint,
  zoomPercent,
} from './image-zoom.js';

/**
 * Геометрия зума просмотрщика изображений (#721): пределы 25–400%, шаги
 * кнопок, вписывание, клампы панорамы, зум «в точку» и двойной клик.
 * Чистые функции без DOM — проверяются напрямую, жесты и панель — в
 * `image-viewer.test.tsx`.
 */

describe('зум: пределы и шаги', () => {
  it('кламп держит 25–400%', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it('мусор на входе — 100%, а не NaN', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('шаги «+» идут по остановкам и упираются в потолок', () => {
    expect(nextZoom(1)).toBe(1.25);
    expect(nextZoom(1.37)).toBe(1.5);
    expect(nextZoom(3)).toBe(4);
    expect(nextZoom(4)).toBe(4);
  });

  it('шаги «−» идут вниз и упираются в пол', () => {
    expect(prevZoom(1)).toBe(0.75);
    expect(prevZoom(1.37)).toBe(1.25);
    expect(prevZoom(0.25)).toBe(0.25);
    // Вписывание огромного фото может быть ниже 25% — «−» не должно
    // увеличивать картинку (округление вниз до пола было бы багу).
    expect(prevZoom(0.2)).toBe(0.2);
  });

  it('процент округляется до целого', () => {
    expect(zoomPercent(1.25)).toBe(125);
    expect(zoomPercent(0.3333)).toBe(33);
  });

  it('колесо/пинч масштабирует экспоненциально и клампится', () => {
    expect(wheelZoom(1, 0)).toBe(1);
    expect(wheelZoom(1, -200)).toBeGreaterThan(1);
    expect(wheelZoom(1, 200)).toBeLessThan(1);
    expect(wheelZoom(1, -100000)).toBe(MAX_ZOOM);
    expect(wheelZoom(1, 100000)).toBe(MIN_ZOOM);
  });
});

describe('вписывание в окно', () => {
  it('большое фото вписывается по узкой оси', () => {
    expect(fitZoom({ width: 2000, height: 1000 }, { width: 800, height: 600 })).toBe(0.4);
  });

  it('мелкую картинку не растягивает', () => {
    expect(fitZoom({ width: 100, height: 80 }, { width: 800, height: 600 })).toBe(1);
  });

  it('без размеров (до загрузки) — 100%', () => {
    expect(fitZoom({ width: 0, height: 0 }, { width: 800, height: 600 })).toBe(1);
    expect(fitZoom({ width: 2000, height: 1000 }, { width: 0, height: 0 })).toBe(1);
  });

  it('доля окна (лайтбокс: поля 15%) уменьшает вписывание', () => {
    expect(fitZoom({ width: 2000, height: 1000 }, { width: 800, height: 600 }, 0.85)).toBe(0.34);
    // Мелкую картинку по-прежнему не растягиваем, даже с полями.
    expect(fitZoom({ width: 100, height: 80 }, { width: 800, height: 600 }, 0.85)).toBe(1);
  });

  it('скан по ширине панели: не шире 1200px и не выше 400%', () => {
    expect(widthFitZoom(2400, 800)).toBeCloseTo(800 / 2400, 5);
    expect(widthFitZoom(2400, 4000)).toBe(0.5);
    expect(widthFitZoom(200, 800)).toBe(MAX_ZOOM);
    expect(widthFitZoom(0, 800)).toBe(1);
  });
});

describe('панорама: клампы', () => {
  const image = { width: 1000, height: 500 };

  it('предел — половина переполнения по каждой оси', () => {
    expect(panBounds(image, 2, { width: 800, height: 600 })).toEqual({ x: 600, y: 200 });
  });

  it('вписанная картинка не двигается', () => {
    expect(panBounds(image, 0.5, { width: 800, height: 600 })).toEqual({ x: 0, y: 0 });
  });

  it('сдвиг клампится симметрично — край не уезжает за окно', () => {
    const bounds = { x: 600, y: 200 };
    expect(clampPan({ x: 5000, y: -5000 }, bounds)).toEqual({ x: 600, y: -200 });
    expect(clampPan({ x: -100, y: 50 }, bounds)).toEqual({ x: -100, y: 50 });
  });
});

describe('зум «в точку» и двойной клик', () => {
  it('точка под курсором остаётся на месте', () => {
    // Курсор правее центра на 200px, сдвиг 100px при 100%: контент под
    // курсором уходит на 100px правее — после двукратного зума сдвиг 0.
    expect(zoomAtPoint({ x: 100, y: 0 }, { x: 200, y: 0 }, 1, 2)).toEqual({ x: 0, y: 0 });
    // Зум из центра сдвигает панораму пропорционально.
    expect(zoomAtPoint({ x: 100, y: -40 }, { x: 0, y: 0 }, 1, 2)).toEqual({ x: 200, y: -80 });
  });

  it('двойной клик: «по размеру» → 100% → «по размеру»', () => {
    expect(toggleZoom(0.4, 0.4)).toBe(1);
    expect(toggleZoom(1, 0.4)).toBe(0.4);
    // Из промежуточного масштаба — к вписыванию.
    expect(toggleZoom(2.5, 0.4)).toBe(0.4);
  });

  it('когда 100% и есть вписывание — двукратное увеличение', () => {
    expect(toggleZoom(1, 1)).toBe(2);
    expect(toggleZoom(2, 1)).toBe(1);
  });
});
