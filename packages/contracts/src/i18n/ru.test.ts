import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../errors/error-codes.js';
import { errorMessages, ui } from './ru.js';

describe('i18n/ru: errorMessages', () => {
  it('каждый системный код ошибки имеет русскую строку', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(errorMessages[code], `нет строки для ${code}`).toBeTruthy();
    }
  });
});

describe('i18n/ru: сводка окна редактора (#496)', () => {
  it('поля и закреплённые склоняются по-русски', () => {
    expect(ui.forms.builder.summary(1, 0)).toBe('1 поле');
    expect(ui.forms.builder.summary(2, 1)).toBe('2 поля · 1 закреплено');
    expect(ui.forms.builder.summary(5, 2)).toBe('5 полей · 2 закреплено');
    expect(ui.forms.builder.summary(11, 5)).toBe('11 полей · 5 закреплено');
    expect(ui.forms.builder.summary(21, 0)).toBe('21 поле');
    expect(ui.forms.builder.summary(0, 0)).toBe('0 полей');
  });
});

describe('i18n/ru: плашка «Ответить» в углу пузыря (#729)', () => {
  it('aria-подпись кнопки — полная фраза, не дубль пункта меню', () => {
    // Видимая подпись плашки — пункт меню («Ответить»), а скринридеру нужен
    // глагол с объектом: «Ответить» вне меню не говорит, на что ответ.
    expect(ui.chat.replyToMessage).toBe('Ответить на сообщение');
    expect(ui.chat.replyToMessage).not.toBe(ui.chat.menu.reply);
  });
});
