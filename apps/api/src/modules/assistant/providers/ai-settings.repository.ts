import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';

/**
 * Единственная точка доступа модуля assistant к своим таблицам провайдеров и
 * настроек (patterns.md: Prisma только в repository).
 *
 * Секреты: `apiKeyCiphertext` — шифртекст (core/crypto SecretBoxService);
 * репозиторий его не расшифровывает — это делает сервис на время вызова.
 */

/** Строка провайдера как она лежит в БД. */
export interface ProviderRow {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  authType: string;
  apiKeyCiphertext: string | null;
  apiKeyHint: string | null;
  /** JSONB: разбор и валидация — в сервисе (схемы contracts). */
  headers: unknown;
  enabled: boolean;
  models: unknown;
  sortOrder: number;
}

/** Состояние настроек портала (singleton-строка `global`). */
export interface SettingsRow {
  defaultProviderId: string | null;
  defaultModelId: string | null;
  /** Модель-диспетчер (#917); null — диспетчер выключен. */
  routerProviderId: string | null;
  routerModelId: string | null;
  instructions: string;
}

/** Провайдер на запись: шифртекст уже посчитан сервисом. */
export interface ProviderWrite {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  authType: string;
  apiKeyCiphertext: string | null;
  apiKeyHint: string | null;
  headers: { name: string; value: string }[];
  enabled: boolean;
  /** JSONB-значение: форма — zod-схемы contracts, тип — как у Prisma JSON. */
  models: unknown;
  sortOrder: number;
}

@Injectable()
export class AiSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProviders(): Promise<ProviderRow[]> {
    return this.prisma.assistantProvider.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findProvider(id: string): Promise<ProviderRow | null> {
    return this.prisma.assistantProvider.findUnique({ where: { id } });
  }

  /** Настройки портала: строка создаётся миграцией, но читаем устойчиво. */
  async findSettings(): Promise<SettingsRow> {
    const row = await this.prisma.assistantSettings.findUnique({ where: { id: 'global' } });
    return {
      defaultProviderId: row?.defaultProviderId ?? null,
      defaultModelId: row?.defaultModelId ?? null,
      routerProviderId: row?.routerProviderId ?? null,
      routerModelId: row?.routerModelId ?? null,
      instructions: row?.instructions ?? '',
    };
  }

  /**
   * Полная замена набора провайдеров и настроек в одной транзакции:
   * провайдеры вне списка удаляются (их сессии сохраняют только снимок
   * провайдера/модели в прогоне), остальные upsert-ятся.
   */
  async replaceAll(providers: ProviderWrite[], settings: SettingsRow): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const keep = providers.map((provider) => provider.id);
      await tx.assistantProvider.deleteMany({ where: { id: { notIn: keep } } });
      for (const provider of providers) {
        const common = {
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiFormat: provider.apiFormat,
          authType: provider.authType,
          headers: provider.headers,
          enabled: provider.enabled,
          // JSONB: форма проверена zod-схемами contracts в сервисе.
          models: provider.models as Prisma.InputJsonValue,
          sortOrder: provider.sortOrder,
          apiKeyCiphertext: provider.apiKeyCiphertext,
          apiKeyHint: provider.apiKeyHint,
        };
        await tx.assistantProvider.upsert({
          where: { id: provider.id },
          create: { id: provider.id, ...common },
          update: common,
        });
      }
      await tx.assistantSettings.upsert({
        where: { id: 'global' },
        create: {
          id: 'global',
          defaultProviderId: settings.defaultProviderId,
          defaultModelId: settings.defaultModelId,
          routerProviderId: settings.routerProviderId,
          routerModelId: settings.routerModelId,
          instructions: settings.instructions,
        },
        update: {
          defaultProviderId: settings.defaultProviderId,
          defaultModelId: settings.defaultModelId,
          routerProviderId: settings.routerProviderId,
          routerModelId: settings.routerModelId,
          instructions: settings.instructions,
        },
      });
    });
  }
}
