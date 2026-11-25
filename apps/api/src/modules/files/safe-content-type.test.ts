import { describe, expect, it } from 'vitest';

import {
  FALLBACK_CONTENT_TYPE,
  MAX_CONTENT_TYPE_LENGTH,
  safeContentType,
} from './safe-content-type.js';

/**
 * #1005, security-ревью: клиентский mime не должен ломать заголовок ответа
 * (управляющий символ = ERR_INVALID_CHAR и «висящий» запрос) и не должен
 * раздувать Content-Type до килобайт (файл становится незагружаемым).
 */
describe('safeContentType — mime в Content-Type без падения заголовка', () => {
  it('нормальные mime проходят как есть', () => {
    expect(safeContentType('video/mp4')).toBe('video/mp4');
    expect(safeContentType('text/plain; charset=utf-8')).toBe('text/plain; charset=utf-8');
    expect(safeContentType('application/vnd.openxmlformats-officedocument')).toBe(
      'application/vnd.openxmlformats-officedocument',
    );
  });

  it('управляющие символы/переводы строк — octet-stream', () => {
    expect(safeContentType('text/pl\u0001ain')).toBe(FALLBACK_CONTENT_TYPE);
    expect(safeContentType('video/mp4\r\nX-Injected: 1')).toBe(FALLBACK_CONTENT_TYPE);
    expect(safeContentType('video/mp4\n')).toBe(FALLBACK_CONTENT_TYPE);
  });

  it('пустой, не-ASCII и не-форма mime — octet-stream', () => {
    expect(safeContentType('')).toBe(FALLBACK_CONTENT_TYPE);
    expect(safeContentType('видео/mp4')).toBe(FALLBACK_CONTENT_TYPE);
    expect(safeContentType('video')).toBe(FALLBACK_CONTENT_TYPE);
    expect(safeContentType('hello world')).toBe(FALLBACK_CONTENT_TYPE);
  });

  it('слишком длинный mime (килобайты) — octet-stream', () => {
    const long = `video/${'a'.repeat(MAX_CONTENT_TYPE_LENGTH)}`;
    expect(safeContentType(long)).toBe(FALLBACK_CONTENT_TYPE);
  });
});
