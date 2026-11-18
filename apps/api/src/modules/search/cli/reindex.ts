import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { searchSourceTypeSchema, type SearchSourceType } from '@nodus/contracts';

/**
 * Бэкфилл поисковой проекции (#952, Р16): `pnpm search:reindex [--type=task]
 * [--rebuild]`.
 *
 * `scan` провайдеров идёт пачками 500, upsert идемпотентен — повторный прогон
 * не меняет количество строк. `--rebuild` удаляет строки типа перед сканом
 * (окно неполной выдачи — только обслуживание). После выкатки — шаг runbook:
 * прогнать CLI и проверить `GET /api/v1/search?q=<известная строка>`.
 *
 * Запуск: DATABASE_URL указывает на целевую БД (песочница `nodus_night` или
 * прод через runbook). `.env` подхватывается до импорта AppModule — конфиги
 * модулей читают env на импорте (auth.config бросает без JWT_SECRET).
 */
loadEnv({ path: fileURLToPath(new URL('../../../../../../.env', import.meta.url)) });
// Обслуживающий CLI не должен поднимать второй IMAP-клиент (MailInboxService).
process.env.MAIL_RECEPTION_DISABLED = '1';

const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('../../../app.module.js');
const { PrismaService } = await import('../../../core/database/prisma.service.js');
const { SearchSourceRegistry } = await import('../../../core/ports/search-source.registry.js');
const { SearchIndexService } = await import('../search-index.service.js');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const typeArg = args.find((arg) => arg.startsWith('--type='))?.slice('--type='.length);
  const rebuild = args.includes('--rebuild');
  const parsedType = typeArg ? searchSourceTypeSchema.safeParse(typeArg) : null;
  if (typeArg && !parsedType?.success) {
    throw new Error(`Неизвестный тип «${typeArg}»: task|letter|message|project|employee`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const index = app.get(SearchIndexService);
    const registry = app.get(SearchSourceRegistry);
    const prisma = app.get(PrismaService);

    const types: SearchSourceType[] = parsedType?.success
      ? [parsedType.data]
      : registry.all().map((provider) => provider.searchSourceType);
    if (types.length === 0) {
      throw new Error('Ни один провайдер источников не зарегистрирован');
    }

    for (const type of types) {
      if (rebuild) {
        await prisma.$executeRaw`DELETE FROM search_documents WHERE source_type = ${type}`;
      }
      const processed = await index.scan(type);
      console.log(`${type}: ${processed}`);
    }
    const total = await prisma.searchDocument.count();
    console.log(`search_documents всего: ${total}`);
  } finally {
    await app.close();
    // app.close() не рвёт фоновые Redis/BullMQ-соединения модулей — процесс
    // остаётся жить после работы (наблюдалось зависание CLI на 7+ минут).
    // Выход — в then/catch ниже: тут exit выдал бы 0 и на ошибке (catch
    // main() уже не выполнится).
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
