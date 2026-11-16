import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { Injectable, Optional } from '@nestjs/common';

/** Версия конверта: смена схемы шифрования = новая версия, старые читаются. */
const ENVELOPE_VERSION = 'v1';
const IV_BYTES = 12; // GCM-нонс 96 бит — стандарт NIST SP 800-38D
const TAG_BYTES = 16;

/**
 * Симметричное шифрование секретов в БД (ADR-0044 п. 4): ключи LLM-провайдеров
 * не хранятся в открытом виде и не возвращаются наружу.
 *
 * AES-256-GCM (аутентифицированное шифрование: подмена шифртекста ловится
 * тегом). Ключ выводится HKDF-SHA256 из материала окружения:
 * `SECRETS_ENCRYPTION_KEY`, а если он не задан — из `JWT_SECRET`.
 * Последствие вывода из `JWT_SECRET`: его смена обесценивает сохранённые
 * ключи провайдеров (расшифровка вернёт `null`, админ вводит ключи заново) —
 * поэтому на проде рекомендуется отдельный `SECRETS_ENCRYPTION_KEY`.
 *
 * Формат конверта: `v1.<iv>.<tag>.<шифртекст>` (base64url, без padding).
 */
@Injectable()
export class SecretBoxService {
  private readonly key: Buffer;

  /** @Optional: параметр НЕ для DI (Nest иначе попробует его резолвить) —
   *  тесты передают окружение явно, как SignedUrlService. */
  constructor(@Optional() env: NodeJS.ProcessEnv = process.env) {
    const material = env.SECRETS_ENCRYPTION_KEY?.trim() || env.JWT_SECRET;
    if (!material || material.length < 32) {
      throw new Error('Для шифрования секретов нужен SECRETS_ENCRYPTION_KEY или JWT_SECRET (≥ 32)');
    }
    // Соль и info фиксированы: ключ детерминирован для одного материала,
    // но не совпадает с ключами подписи JWT/HMAC (домены разделены).
    this.key = Buffer.from(
      hkdfSync('sha256', material, 'nodus-secretbox-salt', 'nodus-secretbox-aes-256-gcm', 32),
    );
  }

  /** Зашифровать секрет. */
  seal(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      ENVELOPE_VERSION,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /**
   * Расшифровать секрет. `null` — конверт битый, чужой или ключ сменился:
   * вызывающая сторона считает секрет незаданным (админ вводит заново),
   * наружу исключение не отдаётся.
   */
  open(envelope: string): string | null {
    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) return null;
    const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
    try {
      const iv = Buffer.from(ivPart, 'base64url');
      const tag = Buffer.from(tagPart, 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(dataPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }

  /** Хвост секрета для узнавания в интерфейсе (последние 4 символа). */
  hint(secret: string): string {
    return secret.length <= 4 ? '…' : secret.slice(-4);
  }
}
