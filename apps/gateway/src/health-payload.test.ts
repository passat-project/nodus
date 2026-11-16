import { describe, expect, it } from 'vitest';
import { buildHealthPayload } from './health-payload.ts';

describe('buildHealthPayload', () => {
  it('возвращает status ok и валидную метку времени', () => {
    const payload = buildHealthPayload();

    expect(payload.status).toBe('ok');
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
  });

  it('нездоровое чтение потока — status unavailable (AUD-021)', () => {
    const payload = buildHealthPayload(false, new Date('2026-11-16T00:00:00.000Z'));

    expect(payload).toEqual({
      status: 'unavailable',
      timestamp: '2026-11-16T00:00:00.000Z',
    });
  });
});
