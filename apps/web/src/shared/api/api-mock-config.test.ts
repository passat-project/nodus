import { describe, expect, it, vi } from 'vitest';

import { API_MOCK_DOMAINS, parseApiMockEnv } from './api-mock-config.js';

/**
 * Разбор VITE_API_MOCK (#48): 'true' — все домены (демо), 'false'/пусто —
 * живой API без воркера, иначе — список ещё мокаемых доменов.
 */

describe('parseApiMockEnv (#48)', () => {
  it("'true' — все домены; 'false'/пусто/undefined/пробелы — живой API", () => {
    expect(parseApiMockEnv('true')).toEqual({ enabled: true, domains: 'all' });
    expect(parseApiMockEnv('false')).toEqual({ enabled: false, domains: new Set() });
    expect(parseApiMockEnv('')).toEqual({ enabled: false, domains: new Set() });
    expect(parseApiMockEnv(undefined)).toEqual({ enabled: false, domains: new Set() });
    expect(parseApiMockEnv('   ')).toEqual({ enabled: false, domains: new Set() });
  });

  it('список доменов: пробелы триммятся, пустые элементы игнорируются', () => {
    const config = parseApiMockEnv(' auth, ,chat , tasks,');
    expect(config.enabled).toBe(true);
    expect(config.domains).toEqual(new Set(['auth', 'chat', 'tasks']));
  });

  it('один домен — покомпонентный режим', () => {
    const config = parseApiMockEnv('auth');
    expect(config.enabled).toBe(true);
    expect(config.domains).toEqual(new Set(['auth']));
  });

  it('неизвестные домены игнорируются, warn — один раз на сессию', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const config = parseApiMockEnv('auth, чат');
      expect(config.enabled).toBe(true);
      expect(config.domains).toEqual(new Set(['auth']));
      // Повторный мусор не добавляет второй warn (once-флаг модуля).
      parseApiMockEnv('ещё-мусор');
      const warns = warn.mock.calls.filter((call) => String(call[0]).includes('неизвестный домен'));
      expect(warns).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('домены полей, справочников, CRM, ролей и настроек доступны для моков (#431, #379, #558)', () => {
    const config = parseApiMockEnv('custom-fields,dictionaries,crm,roles,settings');
    expect(config.enabled).toBe(true);
    expect(config.domains).toEqual(
      new Set(['custom-fields', 'dictionaries', 'crm', 'roles', 'settings']),
    );
    // Новые домены — в конце списка: буквальные маршруты писем остаются первыми.
    expect(API_MOCK_DOMAINS.slice(-5)).toEqual([
      'custom-fields',
      'dictionaries',
      'crm',
      'roles',
      'settings',
    ]);
  });

  it('список только из мусора — воркер не нужен (enabled: false)', () => {
    const config = parseApiMockEnv('чат, задачи');
    expect(config.enabled).toBe(false);
    expect(config.domains).toEqual(new Set());
  });
});
