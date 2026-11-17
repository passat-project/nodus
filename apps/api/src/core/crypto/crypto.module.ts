import { Global, Module } from '@nestjs/common';

import { PasswordService } from './password.service.js';
import { SecretBoxService } from './secret-box.service.js';
import { SignedUrlService } from './signed-url.service.js';

/**
 * Криптографические примитивы ядра: PasswordService (Argon2id) глобален —
 * используется auth (проверка паролей) и directory (начальный пароль
 * сотрудника) без межмодульных импортов (I3). SignedUrlService (HMAC-подпись
 * ссылок отдачи файлов, ADR-0013) — потребители: files (проверка) и chat
 * (выпуск URL вложений в DTO). SecretBoxService (AES-256-GCM) — шифрование
 * секретов в БД (ключи LLM-провайдеров, ADR-0044).
 */
@Global()
@Module({
  providers: [PasswordService, SignedUrlService, SecretBoxService],
  exports: [PasswordService, SignedUrlService, SecretBoxService],
})
export class CryptoModule {}
