import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog.js';
import {
  notificationsSettingsTool,
  notificationsUpdateSettingsTool,
} from './notifications.tools.js';

/** #932: настройки уведомлений — просмотр, карточка правки, флаг модуля. */

describe('настройки уведомлений', () => {
  it('просмотр: путь и человеческий текст', () => {
    expect(notificationsSettingsTool.build!({})).toEqual({ path: '/notifications/settings' });
    expect(
      notificationsSettingsTool.project!(
        { dndEnabled: true, dndStart: '22:00', dndEnd: '08:00' },
        {},
      ).text,
    ).toBe('Не беспокоить: включено, тишина 22:00–08:00');
    expect(
      notificationsSettingsTool.project!(
        { dndEnabled: false, dndStart: '22:00', dndEnd: '08:00' },
        {},
      ).text,
    ).toContain('выключено');
  });

  it('правка: частичный патч в теле и карточка словами', () => {
    const input = { patch: { dndEnabled: true, dndStart: '22:00', dndEnd: '08:00' } };
    expect(notificationsUpdateSettingsTool.build!(input)).toEqual({
      method: 'PATCH',
      path: '/notifications/settings',
      body: input.patch,
    });
    expect(notificationsUpdateSettingsTool.card!.summary(input, {} as never)).toBe(
      'Не беспокоить: включить, с 22:00, до 08:00',
    );
    const fields = notificationsUpdateSettingsTool.card!.fields(input, {} as never);
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: 'Не беспокоить', value: 'включено' },
        { label: 'Начало тишины', value: '22:00' },
        { label: 'Конец тишины', value: '08:00' },
      ]),
    );
  });

  it('пустой патч и неверное время отклоняются схемой', () => {
    expect(notificationsUpdateSettingsTool.input.safeParse({ patch: {} }).success).toBe(false);
    expect(
      notificationsUpdateSettingsTool.input.safeParse({ patch: { dndStart: '99:99' } }).success,
    ).toBe(false);
  });

  it('без флага notifications инструментов модуля нет', () => {
    const without = buildCatalog({ permissions: ['assistant.use'], features: [] });
    expect(without.some((tool) => tool.id.startsWith('notifications.'))).toBe(false);
    const withFlag = buildCatalog({ permissions: ['assistant.use'], features: ['notifications'] });
    expect(withFlag.some((tool) => tool.id === 'notifications.settings')).toBe(true);
  });
});
