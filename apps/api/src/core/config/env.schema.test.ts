import { describe, expect, it } from 'vitest';

import { DEFAULT_TRUST_PROXY, parseTrustProxy, validateEnv } from './env.schema.js';

const VALID = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/nodus',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'env-test-secret-key-min-32-chars-long',
  STORAGE_ACCESS_KEY: 'nodus-api',
  STORAGE_SECRET_KEY: 'storage-secret-min-8',
  STORAGE_URL_SECRET: 'storage-url-secret-min-32-chars-xx',
};

describe('validateEnv', () => {
  it('принимает валидное окружение и применяет дефолты', () => {
    const env = validateEnv({ ...VALID });
    expect(env.API_PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.STORAGE_ENDPOINT).toBe('127.0.0.1');
    expect(env.STORAGE_BUCKET).toBe('nodus-files');
  });

  it('требует секреты файлового хранилища (#57)', () => {
    expect(() => validateEnv({ ...VALID, STORAGE_URL_SECRET: 'short' })).toThrow(
      /Невалидное окружение.*STORAGE_URL_SECRET/s,
    );
    expect(() => validateEnv({ ...VALID, STORAGE_SECRET_KEY: undefined })).toThrow(
      /Невалидное окружение.*STORAGE_SECRET_KEY/s,
    );
  });

  it('падает с понятным сообщением без DATABASE_URL', () => {
    expect(() => validateEnv({ REDIS_URL: VALID.REDIS_URL })).toThrow(
      /Невалидное окружение.*DATABASE_URL/s,
    );
  });

  it('отклоняет не-postgresql DATABASE_URL', () => {
    expect(() => validateEnv({ ...VALID, DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(
      /Невалидное окружение/,
    );
  });

  it('COMPANY_TIMEZONE: дефолт Минск, кривой пояс — ошибка старта (#55)', () => {
    expect(validateEnv({ ...VALID }).COMPANY_TIMEZONE).toBe('Europe/Minsk');
    expect(validateEnv({ ...VALID, COMPANY_TIMEZONE: 'UTC' }).COMPANY_TIMEZONE).toBe('UTC');
    expect(() => validateEnv({ ...VALID, COMPANY_TIMEZONE: 'Минск' })).toThrow(
      /Невалидное окружение.*COMPANY_TIMEZONE/s,
    );
  });

  describe('TRUST_PROXY', () => {
    it('по умолчанию — только приватные/локальные хопы (не true)', () => {
      const env = validateEnv({ ...VALID });
      expect(env.TRUST_PROXY).toBe(DEFAULT_TRUST_PROXY);
      expect(env.TRUST_PROXY).toBe('loopback,linklocal,uniquelocal');
      // пустая переменная из шаблона .env = не задана
      expect(validateEnv({ ...VALID, TRUST_PROXY: '' }).TRUST_PROXY).toBe(DEFAULT_TRUST_PROXY);
    });

    it('true/false → boolean, список нормализуется', () => {
      expect(validateEnv({ ...VALID, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
      expect(validateEnv({ ...VALID, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
      expect(
        validateEnv({ ...VALID, TRUST_PROXY: ' loopback , 10.0.0.0/8, fd00::/8,172.18.0.5 ' })
          .TRUST_PROXY,
      ).toBe('loopback,10.0.0.0/8,fd00::/8,172.18.0.5');
    });

    it('мусор — понятная ошибка старта', () => {
      expect(() => validateEnv({ ...VALID, TRUST_PROXY: 'everyone' })).toThrow(
        /Невалидное окружение.*TRUST_PROXY/s,
      );
    });

    it('parseTrustProxy: префиксы и маски валидируются', () => {
      expect(parseTrustProxy('10.0.0.0/33')).toBeNull();
      expect(parseTrustProxy('::1/129')).toBeNull();
      expect(parseTrustProxy('10.0.0.0/255.0.0.0')).toBe('10.0.0.0/255.0.0.0');
      expect(parseTrustProxy('2')).toBeNull(); // хоп-счётчик не поддерживаем
      expect(parseTrustProxy('loopback,,uniquelocal')).toBeNull();
      expect(parseTrustProxy('')).toBeNull();
    });
  });

  describe('OFFICE_JWT_SECRET (#580)', () => {
    it('пустая строка при выключенном офисе = секрет не задан', () => {
      const env = validateEnv({ ...VALID, OFFICE_ENABLED: 'false', OFFICE_JWT_SECRET: '' });
      expect(env.OFFICE_JWT_SECRET).toBeUndefined();
      // Пробелы из .env — тоже «не задано», а не короткий секрет.
      expect(
        validateEnv({ ...VALID, OFFICE_ENABLED: 'false', OFFICE_JWT_SECRET: '   ' })
          .OFFICE_JWT_SECRET,
      ).toBeUndefined();
    });

    it('пустая строка при включённом офисе — понятная ошибка', () => {
      expect(() =>
        validateEnv({ ...VALID, OFFICE_ENABLED: 'true', OFFICE_JWT_SECRET: '' }),
      ).toThrow(/OFFICE_JWT_SECRET обязателен при OFFICE_ENABLED/);
    });

    it('валидный секрет при включённом офисе проходит', () => {
      const secret = 'office-jwt-secret-min-32-chars-long';
      const env = validateEnv({ ...VALID, OFFICE_ENABLED: 'true', OFFICE_JWT_SECRET: secret });
      expect(env.OFFICE_JWT_SECRET).toBe(secret);
    });
  });
});
