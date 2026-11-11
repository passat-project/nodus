import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReadReceiptScheduler } from './viewport-read-scheduler.js';

/** Квитанции просмотров (#102 раунд 2; #770): троттл-планировщик — только
 *  вперёд, не чаще раза в THROTTLE_MS, в фоне НЕ копит наблюдения, flush на
 *  уходе отправляет уже увиденное. */
describe('createReadReceiptScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeSuite(canRead: () => boolean = () => true) {
    const sends: number[] = [];
    const scheduler = createReadReceiptScheduler({
      send: (seq) => sends.push(seq),
      throttleMs: 500,
      canRead,
    });
    return { scheduler, sends };
  }

  it('троттл: серия наблюдений в окне 500 мс уходит ОДНОЙ квитанцией (максимальной)', () => {
    const { scheduler, sends } = makeSuite();
    scheduler.observe(3);
    scheduler.observe(5);
    scheduler.observe(4); // назад — не двигает
    vi.advanceTimersByTime(500);
    expect(sends).toEqual([5]);
  });

  it('только вперёд: seq ниже отправленного — тишина (серверный GREATEST не дёргаем)', () => {
    const { scheduler, sends } = makeSuite();
    scheduler.observe(10);
    vi.advanceTimersByTime(500);
    scheduler.observe(7); // проскроллил вверх
    vi.advanceTimersByTime(2000);
    expect(sends).toEqual([10]);
  });

  it('непрерывный скролл: квитанции не чаще раза в 500 мс, растущим seq', () => {
    const { scheduler, sends } = makeSuite();
    scheduler.observe(1);
    vi.advanceTimersByTime(500); // → 1
    scheduler.observe(2);
    vi.advanceTimersByTime(250);
    scheduler.observe(3); // в окне кулдауна — обновляет pending
    vi.advanceTimersByTime(250); // таймер первого observe — стреляет 3
    scheduler.observe(4);
    vi.advanceTimersByTime(500); // → 4
    expect(sends).toEqual([1, 3, 4]);
  });

  it('в фоне observe не копит: без внимания seq не запоминается', () => {
    const attentive = { value: false };
    const { scheduler, sends } = makeSuite(() => attentive.value);
    scheduler.observe(6); // фон — не заметили
    vi.advanceTimersByTime(500);
    expect(sends).toEqual([]);
    // Вернулся и смотрит: следующее наблюдение (даже с бо́льшим seq) — уже квитанция.
    attentive.value = true;
    scheduler.observe(7);
    vi.advanceTimersByTime(500);
    expect(sends).toEqual([7]);
  });

  it('внимание ушло между observe и таймером — квитанция ждёт возврата', () => {
    const attentive = { value: true };
    const { scheduler, sends } = makeSuite(() => attentive.value);
    scheduler.observe(6);
    attentive.value = false;
    vi.advanceTimersByTime(500);
    expect(sends).toEqual([]); // не отправили в фон
    attentive.value = true;
    scheduler.observe(6); // возврат внимания — тот же seq достаточно
    vi.advanceTimersByTime(500);
    expect(sends).toEqual([6]);
  });

  it('flush на уходе: накопленное при внимании уходит немедленно', () => {
    const attentive = { value: true };
    const { scheduler, sends } = makeSuite(() => attentive.value);
    scheduler.observe(8); // увидели при внимании
    attentive.value = false; // ушли из окна/в трей
    scheduler.flush(); // flush НЕ упирается в guard внимания — это видели
    expect(sends).toEqual([8]);
  });

  it('обновление «назад» при заблокированном таймере перевзводит квитанцию', () => {
    const attentive = { value: true };
    const { scheduler, sends } = makeSuite(() => attentive.value);
    scheduler.observe(5);
    attentive.value = false;
    vi.advanceTimersByTime(500); // fire заблокирован, pending=5
    attentive.value = true;
    scheduler.observe(4); // назад при pending=5 — перевзвод таймера
    vi.advanceTimersByTime(500);
    expect(sends).toEqual([5]);
  });

  it('dispose: накопленное сбрасывается без отправки', () => {
    const { scheduler, sends } = makeSuite();
    scheduler.observe(8);
    scheduler.dispose();
    vi.advanceTimersByTime(2000);
    expect(sends).toEqual([]);
  });

  it('null и пустые наблюдения — тишина', () => {
    const { scheduler, sends } = makeSuite();
    scheduler.observe(null);
    vi.advanceTimersByTime(1000);
    expect(sends).toEqual([]);
  });

  it('дефолтный canRead в jsdom: документ видим — читает', () => {
    const sends: number[] = [];
    const scheduler = createReadReceiptScheduler({
      send: (seq) => sends.push(seq),
      throttleMs: 500,
    });
    scheduler.observe(2);
    vi.advanceTimersByTime(500);
    expect(sends).toEqual([2]);
  });
});
