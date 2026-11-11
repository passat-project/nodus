import { isIP } from 'node:net';
import { z } from 'zod';

/** Доверенные хопы по умолчанию: loopback + link-local + приватные сети (RFC 1918, fc00::/7). */
export const DEFAULT_TRUST_PROXY = 'loopback,linklocal,uniquelocal';

const TRUST_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/** Элемент списка trustProxy: имя диапазона proxy-addr, IP или IP/префикс. */
function isTrustProxyItem(item: string): boolean {
  if (TRUST_PROXY_NAMES.has(item)) return true;
  const [ip, prefix, ...rest] = item.split('/');
  const family = ip ? isIP(ip) : 0;
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return isIP(prefix) === 4 && family === 4; // маска 255.255.0.0
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * TRUST_PROXY → значение Fastify `trustProxy`: boolean или строка-список
 * (Fastify сам режет её по запятой в proxy-addr compile). Хоп-счётчик
 * (число) не поддерживаем: Fastify 5 трактует его fail-closed (не проверяет
 * ближайший хоп). null — невалидно.
 */
export function parseTrustProxy(raw: string): boolean | string | null {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  const items = value.split(',').map((item) => item.trim());
  if (items.length === 0 || !items.every((item) => item.length > 0 && isTrustProxyItem(item))) {
    return null;
  }
  return items.join(',');
}

/** IANA-пояс проверяется движком Intl: опечатка в env падает на старте. */
function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Валидация env при старте (config-no-secrets: fail-fast, без секретов в коде).
 * Вызывается в main.ts до создания приложения: кривое окружение = понятная
 * ошибка сразу, а не TypeError в рантайме (опыт NormaCore, issue #2).
 */
const envSchema = z
  .object({
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    /** Интерфейс, на котором слушает api. Дефолт 0.0.0.0 — прод/Docker и прежнее
     *  поведение; песочница live-stack сужает до 127.0.0.1 (#675), чтобы по
     *  локальной сети был виден только web, а не API с тестовыми паролями. */
    API_HOST: z.string().min(1).default('0.0.0.0'),
    DATABASE_URL: z.url({ protocol: /^postgresql?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Секрет подписи access-JWT (auth); ≥ 32 символов, только из env. */
    JWT_SECRET: z.string().min(32),
    /** TTL access-токена, секунды (канон: 900 = 15 минут). */
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    /** TTL refresh-сессии, дни (канон: 30, скользящая ротация). */
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    /** Secure-флаг refresh-cookie; по умолчанию — NODE_ENV=production. */
    COOKIE_SECURE: z.stringbool().optional(),
    /** Общий IP-rate-limit (запросов/мин). Дефолт 3000: офис за NAT — один IP
     *  на ~170 человек, каждое WS-событие = рефеч; 300/мин душили бы пилот
     *  (вердикт владельца 25.09, раунд 2 #104). Брутфорс-логин защищён отдельно
     *  (Redis-счётчик AuthService), k6 поднимает планку выше через env. */
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(3000),
    /** Каким хопам верить X-Forwarded-* (Fastify `trustProxy`, @fastify/proxy-addr):
     *  `true`/`false` или список через запятую из имён `loopback`/`linklocal`/
     *  `uniquelocal` и IP/CIDR. Дефолт — только приватные/локальные хопы: прод
     *  api за nginx в docker-сети (приватный адрес) видит реальный IP как
     *  раньше, а прямой клиент с публичного адреса подделать XFF не может
     *  (обход per-IP rate-limit, грязный IP в аудите). */
    TRUST_PROXY: z
      .string()
      .optional()
      .transform((raw, ctx) => {
        // Пустая строка (`TRUST_PROXY=` из шаблона) = не задано → дефолт.
        const parsed = parseTrustProxy(raw?.trim() ? raw : DEFAULT_TRUST_PROXY);
        if (parsed === null) {
          ctx.addIssue({
            code: 'custom',
            message: 'true | false | список loopback/linklocal/uniquelocal/IP/CIDR через запятую',
          });
          return z.NEVER;
        }
        return parsed;
      }),
    /** Файловое хранилище (#57, ADR-0013): MinIO/S3. Endpoint — по умолчанию
     *  host-dev (compose публикует MinIO на 127.0.0.1); в docker api получает
     *  STORAGE_ENDPOINT=nodus_minio из compose. */
    STORAGE_ENDPOINT: z.string().min(1).default('127.0.0.1'),
    STORAGE_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
    STORAGE_USE_SSL: z.stringbool().optional(),
    STORAGE_BUCKET: z.string().min(3).max(63).default('nodus-files'),
    STORAGE_ACCESS_KEY: z.string().min(3),
    STORAGE_SECRET_KEY: z.string().min(8),
    /** Секрет подписи ссылок отдачи файлов (HMAC, ADR-0013); ≠ JWT_SECRET. */
    STORAGE_URL_SECRET: z.string().min(32),
    /** TTL подписи ссылок отдачи, секунды (24 ч: кэш браузера + рефечи ленты). */
    STORAGE_URL_TTL_SECONDS: z.coerce.number().int().min(60).default(86_400),
    /** Движок офисного просмотра ONLYOFFICE (#138): выключен, пока не поднят
     *  контейнер документ-сервера (compose profile `office`). */
    OFFICE_ENABLED: z.stringbool().optional(),
    /** Правка в редакторе — отдельный флаг (пилот: сначала просмотр). */
    OFFICE_EDIT_ENABLED: z.stringbool().optional(),
    /** Общий секрет JWT с документ-сервером (требуется при OFFICE_ENABLED).
     *  Пустая строка из compose (`${OFFICE_JWT_SECRET:-}`) = «не задано»:
     *  иначе выключенный офис роняет api на старте (#580). */
    OFFICE_JWT_SECRET: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().min(32).optional(),
    ),
    /** Как api обращается к документ-серверу (скачивание сохранённых файлов). */
    OFFICE_INTERNAL_URL: z.url().default('http://127.0.0.1:3013'),
    /** Как документ-сервер обращается к api (document.url + callbackUrl):
     *  внутренний адрес сети, НЕ браузерный origin. */
    OFFICE_API_INTERNAL_URL: z.url().default('http://127.0.0.1:3001'),
    /** Потолок размера файла на открытие в редакторе (50 МБ: гигантские листы
     *  открываются карточкой скачивания — спека #138). */
    OFFICE_MAX_VIEW_BYTES: z.coerce.number().int().min(1).default(52_428_800),
    /** Часовой пояс компании (#55, F7): границы года нумерации и дата
     *  регистрации писем. IANA-имя, проверяется Intl при старте. */
    COMPANY_TIMEZONE: z
      .string()
      .default('Europe/Minsk')
      .refine(isValidTimeZone, 'IANA-пояс, например Europe/Minsk'),
    /** «Важные сообщения» (#100): интервал повторных напоминаний, секунды
     *  (канон Mattermost persistent: 300 = 5 мин). Тесты/live-приёмка сжимают. */
    NOTIFY_URGENT_REPEAT_SEC: z.coerce.number().int().min(1).default(300),
    /** Потолок повторов важного, секунды (ревизия 05.10: 3600 = час, пуш каждые 5 мин × 12). */
    NOTIFY_URGENT_MAX_SEC: z.coerce.number().int().min(2).default(3600),
    /** Суточный лимит «важных сообщений» на отправителя (C5; дисциплину
     *  даёт лимит, не иерархия — вердикт 30.09). */
    NOTIFY_URGENT_DAILY_LIMIT: z.coerce.number().int().min(1).default(3),
    /** Потолок участников беседы для «важного сообщения» (C10, I8). */
    NOTIFY_URGENT_GROUP_MAX: z.coerce.number().int().min(2).default(20),
    /** Десктоп-оболочка (#254): имя сервера на экране подключения клиента. */
    NODUS_SERVER_NAME: z.string().min(1).max(120).default('Nodus'),
    /** Минимальная версия оболочки (semver); 0.0.0 — без ограничения. */
    NODUS_MIN_SHELL_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'формат major.minor.patch')
      .default('0.0.0'),
  })
  .refine((env) => !env.OFFICE_ENABLED || Boolean(env.OFFICE_JWT_SECRET), {
    message: 'OFFICE_JWT_SECRET обязателен при OFFICE_ENABLED',
    path: ['OFFICE_JWT_SECRET'],
  });

export type Env = z.infer<typeof envSchema>;

/** Парсит process.env; при ошибке бросает с перечнем невалидных переменных. */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Невалидное окружение: ${problems}`);
  }
  return result.data;
}
