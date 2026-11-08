import { describe, expect, it } from 'vitest';
import { effectiveWindowSections } from '@nodus/contracts';

import { checkFormInput, parseForm } from './transition-form.js';
import { parseRules } from './transition-rules.js';

const sectionsOf = (form: unknown, validators: unknown[] = []) =>
  effectiveWindowSections(parseForm(form), parseRules({ validators }));

describe('окно перехода на сервере (#380)', () => {
  it('parseForm: {} — выключенное окно; неизвестный вид — ошибка', () => {
    expect(parseForm({})).toEqual({ enabled: false, sections: [] });
    expect(() => parseForm({ enabled: true, sections: [{ kind: 'questions' }] })).toThrow();
  });

  it('parseForm (#496, I-P1): неизвестные свойства поля и виды оформления пропускаются', () => {
    const form = parseForm({
      enabled: true,
      sections: [
        {
          kind: 'fields',
          fields: [
            'deadline',
            { key: 'description', width: 'half', future: true },
            { kind: 'heading', id: 'dabcdef1', text: 'Кому и что', color: 'red' },
            { kind: 'divider', id: 'dabcdef2' },
          ],
        },
      ],
    });
    expect(form.sections).toEqual([
      {
        kind: 'fields',
        fields: [
          'deadline',
          { key: 'description', width: 'half' },
          { kind: 'heading', id: 'dabcdef1', text: 'Кому и что' },
        ],
      },
    ]);
  });

  it('parseForm (#496, I-P1): негодные замки — ошибка, годные читаются', () => {
    const base = { enabled: true, sections: [{ kind: 'fields', fields: ['deadline'] }] };
    expect(() => parseForm({ ...base, locks: [{ key: 'deadline' }] })).toThrow();
    expect(() =>
      parseForm({
        ...base,
        locks: [
          { key: 'deadline', editors: 'none' },
          { key: 'deadline', editors: 'owners' },
        ],
      }),
    ).toThrow();
    expect(parseForm({ ...base, locks: [{ key: 'deadline', editors: 'owners' }] }).locks).toEqual([
      { key: 'deadline', editors: 'owners' },
    ]);
  });

  it('обязательная причина отсутствует — missing', () => {
    const sections = sectionsOf({
      enabled: true,
      sections: [{ kind: 'comment', label: 'Причина', required: true }],
    });
    expect(checkFormInput(sections, {})).toEqual({ missing: ['comment'], unexpected: [] });
    expect(checkFormInput(sections, { comment: 'Согласование' }).missing).toEqual([]);
  });

  it('обязательные сообщения: нужен хотя бы один messageId', () => {
    const sections = sectionsOf({
      enabled: true,
      sections: [{ kind: 'result_messages', required: true }],
    });
    expect(checkFormInput(sections, {}).missing).toEqual(['result_messages']);
    expect(
      checkFormInput(sections, {
        result: { text: '', messageIds: [crypto.randomUUID()] },
      }).missing,
    ).toEqual([]);
  });

  it('раздел не настроен и гейта нет — ввод лишний', () => {
    const sections = sectionsOf({ enabled: false, sections: [] });
    expect(checkFormInput(sections, { comment: 'x' }).unexpected).toEqual(['comment']);
    expect(
      checkFormInput(sections, { result: { text: 'итог', messageIds: [] } }).unexpected,
    ).toEqual(['result']);
  });

  it('поля — только из раздела fields', () => {
    const sections = sectionsOf({
      enabled: true,
      sections: [{ kind: 'fields', fields: ['deadline'] }],
    });
    expect(
      checkFormInput(sections, { fields: { deadline: '2026-10-25T12:00:00.000Z' } }).unexpected,
    ).toEqual([]);
    expect(checkFormInput(sections, { fields: { description: 'x' } }).unexpected).toEqual([
      'fields.description',
    ]);
  });

  it('итог разрешён любым из разделов result/result_files/result_messages', () => {
    for (const kind of ['result', 'result_files', 'result_messages'] as const) {
      const section =
        kind === 'result'
          ? { kind }
          : kind === 'result_files'
            ? { kind, label: 'Акт' }
            : { kind, required: false };
      const sections = sectionsOf({ enabled: true, sections: [section] });
      expect(
        checkFormInput(sections, { result: { text: 'итог', messageIds: [] } }).unexpected,
      ).toEqual([]);
    }
  });

  it('гейт result_files даёт раздел без настройки окна', () => {
    const sections = sectionsOf({}, [{ kind: 'result_files', min: 1 }]);
    expect(sections.map((s) => s.kind)).toEqual(['result_files']);
  });
});
