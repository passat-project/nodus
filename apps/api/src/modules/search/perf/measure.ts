import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { searchRequestSchema } from '@nodus/contracts';

/**
 * Perf-харнесс поиска (#952, P4): генератор сообщений + замер p95.
 *
 * `pnpm search:perf -- --count=50000` (по умолчанию 50 000). Запускать на
 * песочнице (night-БД), не на проде: скрипт пишет реальные строки, индексирует
 * их штатным путём и после замера удаляет (если не передан `--keep`).
 *
 * Критерий приёмки: p95 `GET /search`-запроса < 150 мс на ≥50k документов,
 * топ-100, без реранка. Замер идёт через `SearchService` (полный путь:
 * видимость → три ноги → имена → DTO), а не по голому SQL.
 */
loadEnv({ path: fileURLToPath(new URL('../../../../../../.env', import.meta.url)) });
// Perf-прогон не поднимает второй IMAP-клиент (MailInboxService).
process.env.MAIL_RECEPTION_DISABLED = '1';

const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('../../../app.module.js');
const { PrismaService } = await import('../../../core/database/prisma.service.js');
const { SearchIndexService } = await import('../search-index.service.js');
const { SearchService } = await import('../search.service.js');

const QUERIES = ['согласование', 'фасад', 'труба 57', 'Галур', 'смета', 'ПП-123', 'закупка'];

async function main(): Promise<void> {
  // Харнесс пишет реальные строки: только песочница (night-БД). Корневой
  // .env по готче указывает на прод — без проверки прогон ушёл бы туда.
  const dbName = new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//u, '');
  if (!dbName.endsWith('_night') && process.env.SEARCH_PERF_ALLOW_ANY_DB !== '1') {
    throw new Error(
      `Perf-харнесс пишет данные: нужна night-БД песочницы (nodus_night), сейчас «${dbName}». ` +
        'Осознанное исключение — SEARCH_PERF_ALLOW_ANY_DB=1.',
    );
  }
  const args = process.argv.slice(2);
  const count = Number(args.find((arg) => arg.startsWith('--count='))?.split('=')[1] ?? 50_000);
  const keep = args.includes('--keep');
  const run = randomUUID().slice(0, 8);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const index = app.get(SearchIndexService);
  const search = app.get(SearchService);
  const actorId = randomUUID();
  const conversationId = randomUUID();
  try {
    await prisma.user.create({
      data: {
        id: actorId,
        email: `search-perf-${run}@example.test`,
        passwordHash: 'x',
        lastName: 'Perf',
        firstName: 'Perf',
        displayName: `Perf ${run}`,
      },
    });
    await prisma.conversation.create({
      data: {
        id: conversationId,
        type: 'group',
        title: `Perf ${run}`,
        permissions: {},
        createdBy: actorId,
      },
    });
    await prisma.conversationMember.create({
      data: { conversationId, userId: actorId, role: 'owner' },
    });

    const ids: string[] = [];
    const batchSize = 1_000;
    for (let offset = 0; offset < count; offset += batchSize) {
      const batch = Math.min(batchSize, count - offset);
      await prisma.message.createMany({
        data: Array.from({ length: batch }, (_, i) => {
          const id = randomUUID();
          ids.push(id);
          return {
            id,
            conversationId,
            seq: BigInt(offset + i + 1),
            authorId: actorId,
            clientMessageId: `perf-${run}-${offset + i}`,
            text: `Сообщение ${offset + i} по объекту ${run}-${(offset + i) % 997} ${
              // Реалистичная частота: поисковое слово встречается в ~3%
              // сообщений (все сообщения со словом — худший случай, где
              // seq scan дешевле GIN и 3-секундный таймаут — штатный отказ).
              (offset + i) % 33 === 0
                ? QUERIES[((offset + i) / 33) % QUERIES.length]
                : 'рабочая переписка'
            }`,
          };
        }),
      });
    }

    const indexedAt = Date.now();
    for (let offset = 0; offset < ids.length; offset += 500) {
      await index.indexIds('message', ids.slice(offset, offset + 500));
    }
    console.log(`проиндексировано ${ids.length} сообщений за ${Date.now() - indexedAt} мс`);

    const actor = {
      id: actorId,
      email: `search-perf-${run}@example.test`,
      displayName: 'Perf',
      permissions: ['directory.read'],
    };
    const durations: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const query = QUERIES[i % QUERIES.length]!;
      const started = performance.now();
      const response = await search.search(actor, searchRequestSchema.parse({ q: query }));
      durations.push(performance.now() - started);
      if (i === 0) console.log(`первый ответ: ${response.tookMs} мс, ${response.total} совпадений`);
    }
    durations.sort((a, b) => a - b);
    const p = (share: number) =>
      durations[Math.min(durations.length - 1, Math.floor(durations.length * share))]!;
    console.log(
      `p50 ${p(0.5).toFixed(1)} мс · p95 ${p(0.95).toFixed(1)} мс · max ${p(1).toFixed(1)} мс (30 запросов)`,
    );
  } finally {
    if (!keep) {
      await prisma.searchDocument.deleteMany({ where: { conversationId } });
      await prisma.message.deleteMany({ where: { conversationId } });
      await prisma.conversation.deleteMany({ where: { id: conversationId } });
      await prisma.searchQuery.deleteMany({ where: { actorId } });
      await prisma.user.deleteMany({ where: { id: actorId } });
      console.log('данные замера удалены (--keep оставляет)');
    }
    await app.close();
    // Выход — в then/catch ниже: exit в finally выдал бы 0 и на ошибке.
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
