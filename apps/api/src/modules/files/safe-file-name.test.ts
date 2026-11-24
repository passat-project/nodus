import { describe, expect, it } from 'vitest';

import { FALLBACK_FILE_NAME, MAX_FILE_NAME_LENGTH, safeFileName } from './safe-file-name.js';

/**
 * #1005, security-ревью: имя из multipart не должно раздувать заголовок
 * Content-Disposition (encodeURIComponent ~3×), а обрезка не должна рвать
 * суррогатную пару (иначе encodeURIComponent бросает URIError).
 */
describe('safeFileName — имя для хранения и Content-Disposition', () => {
  it('короткое имя не меняется, управляющие символы вырезаются', () => {
    expect(safeFileName('смета.pdf')).toBe('смета.pdf');
    expect(safeFileName('акт\u0001\n.pdf')).toBe('акт.pdf');
    expect(safeFileName('  отчёт.xlsx  ')).toBe('отчёт.xlsx');
  });

  it('длинное имя обрезается с сохранением расширения', () => {
    const long = `${'a'.repeat(480)}.webm`;
    const result = safeFileName(long);
    expect(result.length).toBe(MAX_FILE_NAME_LENGTH);
    expect(result.endsWith('.webm')).toBe(true);
  });

  it('длинное имя без расширения — ровный потолок', () => {
    const result = safeFileName('б'.repeat(500));
    expect(result.length).toBe(MAX_FILE_NAME_LENGTH);
  });

  it('длина на границе не трогается', () => {
    const name = `${'x'.repeat(MAX_FILE_NAME_LENGTH - 4)}.pdf`;
    expect(safeFileName(name)).toBe(name);
  });

  it('эмодзи на границе обрезки не рвётся на суррогаты', () => {
    const inside = `${'a'.repeat(190)}📊${'b'.repeat(20)}.pdf`;
    const kept = safeFileName(inside);
    expect(kept).toContain('📊');
    expect(() => encodeURIComponent(kept)).not.toThrow();

    // Эмодзи не помещается в бюджет — отбрасываем целиком, а не половину пары.
    const boundary = `${'a'.repeat(195)}📊${'b'.repeat(20)}.pdf`;
    const cut = safeFileName(boundary);
    expect(cut.length).toBeLessThanOrEqual(MAX_FILE_NAME_LENGTH);
    expect(cut.endsWith('.pdf')).toBe(true);
    expect(() => encodeURIComponent(cut)).not.toThrow();
    expect(cut).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('одиночный суррогат и пустое имя — безопасный фолбэк', () => {
    expect(safeFileName('\ud83d')).toBe(FALLBACK_FILE_NAME);
    expect(safeFileName(' \u0001\n ')).toBe(FALLBACK_FILE_NAME);
    expect(() => encodeURIComponent(safeFileName('\ud83d'))).not.toThrow();
  });
});
