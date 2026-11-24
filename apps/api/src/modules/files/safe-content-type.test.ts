import { describe, expect, it } from 'vitest';

import { FALLBACK_CONTENT_TYPE, safeContentType } from './safe-content-type.js';

/**
 * #1005, security-ревью: клиентский mime не должен ломать заголовок ответа
 * (управляющий символ = ERR_INVALID_CHAR и «висящий» запрос).
 */
describe('safeContentType — mime в Content-Type без падения заголовка', () => {
  it('нормальные mime проходят как есть', () => {
    expect(safeContentType('video/mp4')).toBe('video/mp4');
    expect(safeContentType('text/plain; charset=utf-8')).toBe('text/plain; charset=utf-8');
  });

  it('управляющие символы/переводы строк — octet-stream', () => {
    expect(safeContentType('text/pl\u0001ain')).toBe(FALLBACK_CONTENT_TYPE);
    expect(safeContentType('video/mp4\r\nX-Injected: 1')).toBe(FALLBACK_CONTENT_TYPE);
    expect(safeContentType('video/mp4\n')).toBe(FALLBACK_CONTENT_TYPE);
  });

  it('пустой и не-ASCII — octet-stream', () => {
    expect(safeContentType('')).toBe(FALLBACK_CONTENT_TYPE);
    expect(safeContentType('видео/mp4')).toBe(FALLBACK_CONTENT_TYPE);
  });
});
