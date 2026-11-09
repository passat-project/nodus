import { describe, expect, it } from 'vitest';
import type { EffectiveSection } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { missingLabel, PREVIEW_CONTEXT, sectionTitle } from './window-labels.js';

/** Подписи разделов окна перехода (#496): своё имя блока или стандартное,
 *  и подпись пропущенного раздела в ошибке 422. */

const section = (value: Record<string, unknown>): EffectiveSection =>
  value as unknown as EffectiveSection;

describe('окно перехода: подписи разделов', () => {
  it('своя подпись блока побеждает стандартную; пустая — не считается', () => {
    expect(sectionTitle(section({ kind: 'comment', label: 'Причина отказа' }))).toBe(
      'Причина отказа',
    );
    expect(sectionTitle(section({ kind: 'comment', label: '   ' }))).toBe(
      ui.tasks.window.commentLabel,
    );
    expect(sectionTitle(section({ kind: 'result_files' }))).toBe(ui.tasks.window.filesLabel);
  });

  it('стандартные названия каждого раздела', () => {
    expect(sectionTitle(section({ kind: 'fields' }))).toBe(ui.tasks.window.fieldsLabel);
    expect(sectionTitle(section({ kind: 'time' }))).toBe(ui.tasks.window.timeLabel);
    expect(sectionTitle(section({ kind: 'result' }))).toBe(ui.tasks.window.resultLabel);
    expect(sectionTitle(section({ kind: 'result_messages' }))).toBe(ui.tasks.window.messagesLabel);
    expect(sectionTitle(section({ kind: 'registration' }))).toBe(
      ui.automation.window.sections.registration,
    );
  });

  it('пропущенный обязательный раздел — понятная подпись, поле — ключ', () => {
    expect(missingLabel('comment')).toBe(ui.tasks.window.commentLabel);
    expect(missingLabel('result_messages')).toBe(ui.tasks.window.messagesLabel);
    expect(missingLabel('registration')).toBe(ui.automation.window.sections.registration);
    expect(missingLabel('deadline')).toBe('deadline');
  });

  it('пустой контекст превью: данные пустые, права полные', () => {
    expect(PREVIEW_CONTEXT).toMatchObject({
      entityId: '',
      conversationId: null,
      scope: 'entity',
      access: { canEdit: true, canLogTime: true, canCheck: true },
      fields: { description: '', customFields: {} },
      customFieldDefinitions: [],
    });
  });
});
