import { describe, expect, it } from 'vitest';

import { notificationSettingsSchema } from './notifications.schemas.js';

/** DND-время (#843): «99:99» — не время суток, только 00:00…23:59. */
describe('notificationSettingsSchema: время «не беспокоить»', () => {
  const settings = (start: string, end: string) =>
    notificationSettingsSchema.safeParse({ dndEnabled: true, dndStart: start, dndEnd: end });

  it('принимает границы суток', () => {
    expect(settings('00:00', '23:59').success).toBe(true);
    expect(settings('09:05', '18:00').success).toBe(true);
  });

  it('отклоняет несуществующее время', () => {
    for (const [start, end] of [
      ['99:99', '18:00'],
      ['24:00', '18:00'],
      ['09:60', '18:00'],
      ['9:00', '18:00'],
      ['09:00', '18:00:00'],
    ]) {
      expect(settings(start!, end!), `${start}–${end}`).toMatchObject({ success: false });
    }
  });
});
