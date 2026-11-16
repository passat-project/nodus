import { describe, expect, it } from 'vitest';

import { SecretBoxService } from './secret-box.service.js';

/**
 * Шифрование ключей провайдеров (ADR-0044 п. 4): AES-256-GCM, конверт
 * `v1.<iv>.<tag>.<ct>`; чужой ключ/подмена — `null`, не исключение
 * (админ вводит ключ заново, портал не падает).
 */

const env = { JWT_SECRET: 'x'.repeat(40) } as NodeJS.ProcessEnv;

describe('SecretBoxService', () => {
  it('шифрует и расшифровывает секрет; конверт не содержит открытого текста', () => {
    const box = new SecretBoxService(env);
    const sealed = box.seal('sk-live-abcdef123456');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('sk-live');
    expect(box.open(sealed)).toBe('sk-live-abcdef123456');
  });

  it('разные IV: одинаковый текст даёт разные конверты', () => {
    const box = new SecretBoxService(env);
    expect(box.seal('same')).not.toBe(box.seal('same'));
  });

  it('подмена шифртекста ловится тегом (GCM) — open возвращает null', () => {
    const box = new SecretBoxService(env);
    const sealed = box.seal('secret');
    const parts = sealed.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]}AAAA`].join('.');
    expect(box.open(tampered)).toBeNull();
  });

  it('чужой ключ шифрования не расшифровывает старый конверт', () => {
    const first = new SecretBoxService({ JWT_SECRET: 'a'.repeat(40) } as NodeJS.ProcessEnv);
    const second = new SecretBoxService({ JWT_SECRET: 'b'.repeat(40) } as NodeJS.ProcessEnv);
    expect(second.open(first.seal('secret'))).toBeNull();
  });

  it('SECRETS_ENCRYPTION_KEY приоритетнее JWT_SECRET и домены ключей разделены', () => {
    const base = { JWT_SECRET: 'j'.repeat(40) } as NodeJS.ProcessEnv;
    const dedicated = {
      JWT_SECRET: 'j'.repeat(40),
      SECRETS_ENCRYPTION_KEY: 's'.repeat(40),
    } as NodeJS.ProcessEnv;
    const fromJwt = new SecretBoxService(base);
    const fromDedicated = new SecretBoxService(dedicated);
    expect(fromDedicated.open(fromJwt.seal('secret'))).toBeNull();
    expect(new SecretBoxService(dedicated).open(fromDedicated.seal('secret'))).toBe('secret');
  });

  it('хвост ключа — последние 4 символа, короткий не раскрывается', () => {
    const box = new SecretBoxService(env);
    expect(box.hint('sk-live-abcdef1234')).toBe('1234');
    expect(box.hint('abc')).toBe('…');
  });

  it('без материала ключа сервис не создаётся (fail-fast)', () => {
    expect(() => new SecretBoxService({} as NodeJS.ProcessEnv)).toThrow();
    expect(() => new SecretBoxService({ JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow();
  });
});
