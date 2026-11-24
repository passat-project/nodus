import { describe, expect, it } from 'vitest';

import {
  companyDate,
  companyDateTimeRu,
  companyTimeZone,
  companyYear,
  DEFAULT_COMPANY_TIMEZONE,
} from './company-time.js';

describe('company-time (#55, F7)', () => {
  it('граница года — по Минску, а не по UTC', () => {
    // 31.12.2026 23:30 UTC = 01.01.2027 02:30 в Минске (UTC+3).
    const at = new Date('2026-12-31T23:30:00.000Z');
    expect(companyYear(at, 'Europe/Minsk')).toBe(2027);
    expect(companyYear(at, 'UTC')).toBe(2026);
  });

  it('дата регистрации — день Минска', () => {
    expect(companyDate(new Date('2026-12-31T23:30:00.000Z'), 'Europe/Minsk')).toBe('2027-01-01');
    expect(companyDate(new Date('2026-10-27T08:00:00.000Z'), 'Europe/Minsk')).toBe('2026-10-27');
  });

  it('дата/время человеком — без сдвига на день у вечерних сроков (#996)', () => {
    // 5 декабря 00:00 в Минске = 4 декабря 21:00 UTC: в UTC дата была бы 4-м.
    expect(companyDateTimeRu(new Date('2026-12-04T21:00:00.000Z'), 'Europe/Minsk')).toBe(
      '5 декабря, 00:00',
    );
    expect(companyDateTimeRu(new Date('2026-12-05T14:00:00.000Z'), 'Europe/Minsk')).toBe(
      '5 декабря, 17:00',
    );
  });

  it('пояс по умолчанию — Europe/Minsk, env переопределяет', () => {
    expect(companyTimeZone({})).toBe(DEFAULT_COMPANY_TIMEZONE);
    expect(companyTimeZone({ COMPANY_TIMEZONE: ' ' })).toBe(DEFAULT_COMPANY_TIMEZONE);
    expect(companyTimeZone({ COMPANY_TIMEZONE: 'UTC' })).toBe('UTC');
  });
});
