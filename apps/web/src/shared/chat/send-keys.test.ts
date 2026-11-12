import { describe, expect, it } from 'vitest';

import { isImeComposing, isNewlineShortcut, isSendShortcut } from './send-keys.js';

const key = (
  keyName: string,
  mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {},
) => ({
  key: keyName,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('send-keys: классика мессенджеров (вердикт владельца 14.09.2026)', () => {
  it('Enter без модификаторов — отправка', () => {
    expect(isSendShortcut(key('Enter'))).toBe(true);
  });

  it('ЛЮБОЙ Enter с модификатором — не отправка (#777: meta/alt раньше уходили)', () => {
    expect(isSendShortcut(key('Enter', { shiftKey: true }))).toBe(false);
    expect(isSendShortcut(key('Enter', { ctrlKey: true }))).toBe(false);
    expect(isSendShortcut(key('Enter', { metaKey: true }))).toBe(false);
    expect(isSendShortcut(key('Enter', { altKey: true }))).toBe(false);
    expect(isSendShortcut(key('Enter', { ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('прочие клавиши — не отправка', () => {
    expect(isSendShortcut(key('a'))).toBe(false);
    expect(isSendShortcut(key('Escape'))).toBe(false);
  });
});

describe('send-keys: isNewlineShortcut (#777 — Ctrl+Enter вставляет перенос)', () => {
  it('Ctrl/Meta/Alt+Enter — перенос строки', () => {
    expect(isNewlineShortcut(key('Enter', { ctrlKey: true }))).toBe(true);
    expect(isNewlineShortcut(key('Enter', { metaKey: true }))).toBe(true);
    expect(isNewlineShortcut(key('Enter', { altKey: true }))).toBe(true);
    expect(isNewlineShortcut(key('Enter', { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it('чистый и Shift+Enter — не наш перенос (Shift нативен браузеру)', () => {
    expect(isNewlineShortcut(key('Enter'))).toBe(false);
    expect(isNewlineShortcut(key('Enter', { shiftKey: true }))).toBe(false);
  });

  it('прочие клавиши — не перенос', () => {
    expect(isNewlineShortcut(key('a', { ctrlKey: true }))).toBe(false);
    expect(isNewlineShortcut(key('Escape', { ctrlKey: true }))).toBe(false);
  });
});

describe('send-keys: IME-композиция (#777)', () => {
  it('isComposing на nativeEvent — Enter принадлежит IME', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeComposing({ nativeEvent: { isComposing: false } })).toBe(false);
    expect(isImeComposing({})).toBe(false);
  });
});
