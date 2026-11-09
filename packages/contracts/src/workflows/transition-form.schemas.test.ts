import { describe, expect, it } from 'vitest';

import { timeEntryCreateBodySchema } from '../tasks/task-time.schemas.js';
import { transitionFormInputSchema, transitionFormSchema } from './transition-form.schemas.js';

const section = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, ...extra });

describe('transitionFormSchema (#380)', () => {
  it('{} → окно выключено (колонка БД с DEFAULT {})', () => {
    expect(transitionFormSchema.parse({})).toEqual({ enabled: false, sections: [] });
  });

  it('каждый вид раздела проходит', () => {
    const form = {
      enabled: true,
      title: 'Завершение',
      sections: [
        section('fields', { fields: ['deadline', 'assignee'] }),
        section('time', { mode: 'if_empty' }),
        section('result'),
        section('result_files', { label: 'Акт выполненных работ' }),
        section('result_messages', { required: true }),
        section('comment', { label: 'Причина', required: true }),
      ],
    };
    expect(transitionFormSchema.parse(form)).toMatchObject(form);
  });

  it('неизвестный вид раздела отвергается (закрытый реестр ADR-0020)', () => {
    expect(() =>
      transitionFormSchema.parse({ enabled: true, sections: [{ kind: 'questions' }] }),
    ).toThrow();
  });

  it('.strict(): лишний ключ раздела и формы отвергается', () => {
    expect(() =>
      transitionFormSchema.parse({
        enabled: true,
        sections: [{ kind: 'result', required: true }],
      }),
    ).toThrow();
    expect(() => transitionFormSchema.parse({ enabled: true, sections: [], extra: 1 })).toThrow();
  });

  it('подпись блока ≤ 60, пустая — стандартное название раздела (#496)', () => {
    const parsed = transitionFormSchema.parse({
      enabled: true,
      sections: [{ kind: 'comment', label: ' ', required: false }],
    });
    expect(parsed.sections[0]).toMatchObject({ kind: 'comment', label: '' });
    expect(() =>
      transitionFormSchema.parse({
        enabled: true,
        sections: [{ kind: 'comment', label: 'я'.repeat(61), required: false }],
      }),
    ).toThrow();
  });

  it('поля: 1..4 и без дублей', () => {
    expect(() =>
      transitionFormSchema.parse({ enabled: true, sections: [{ kind: 'fields', fields: [] }] }),
    ).toThrow();
    expect(() =>
      transitionFormSchema.parse({
        enabled: true,
        sections: [{ kind: 'fields', fields: ['deadline', 'deadline'] }],
      }),
    ).toThrow();
  });
});

describe('transitionFormInputSchema (#380)', () => {
  it('пустой ввод допустим (нет обязательных разделов)', () => {
    expect(transitionFormInputSchema.parse({})).toEqual({});
  });

  it('.strict(): лишние ключи отвергаются', () => {
    expect(() => transitionFormInputSchema.parse({ unknown: true })).toThrow();
    expect(() => transitionFormInputSchema.parse({ fields: { title: 'x' } })).toThrow();
  });

  it('время 1..1440 и паритет с timeEntryCreateBodySchema', () => {
    for (const minutes of [0, 1441]) {
      expect(() =>
        transitionFormInputSchema.parse({ time: { minutes, date: '2026-10-25' } }),
      ).toThrow();
      expect(() => timeEntryCreateBodySchema.parse({ minutes, date: '2026-10-25' })).toThrow();
    }
    expect(transitionFormInputSchema.parse({ time: { minutes: 90, date: '2026-10-25' } })).toEqual({
      time: { minutes: 90, date: '2026-10-25' },
    });
  });

  it('messageIds: ≤ 50 и уникальные', () => {
    const ids = Array.from({ length: 51 }, () => crypto.randomUUID());
    expect(() =>
      transitionFormInputSchema.parse({ result: { text: '', messageIds: ids } }),
    ).toThrow();
    const one = crypto.randomUUID();
    expect(() =>
      transitionFormInputSchema.parse({ result: { text: '', messageIds: [one, one] } }),
    ).toThrow();
  });

  it('поля — только известные ключи и хотя бы одно значение', () => {
    expect(
      transitionFormInputSchema.parse({ fields: { deadline: '2026-10-25T12:00:00.000Z' } }),
    ).toEqual({ fields: { deadline: '2026-10-25T12:00:00.000Z' } });
    expect(() => transitionFormInputSchema.parse({ fields: {} })).toThrow();
  });
});
