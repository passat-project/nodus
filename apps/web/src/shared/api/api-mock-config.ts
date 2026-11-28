/**
 * Конфиг покомпонентного переключения моков (#48): VITE_API_MOCK —
 * 'true' (все домены мокаются, демо-сборка nodus.by) | 'false'/пусто
 * (всё на живом API) | список ещё мокаемых доменов через запятую
 * ('auth,tasks' — живой логин + моки остальных: режим приёмки треков
 * бэкенда). Слой shared/api: потребители — app (старт MSW-воркера) и
 * shared/chat (polling живого чата); shared не импортирует app
 * (boundaries: направление слоёв app → features → shared).
 */

/** Домены, моками которых управляет флаг. Ключи карты хендлеров —
 *  app/mocks-handlers.ts (Record<ApiMockDomain, …> — новый домен не забудут). */
export const API_MOCK_DOMAINS = [
  'auth',
  'directory',
  'tasks',
  'letters',
  'projects',
  'chat',
  'home',
  'files',
  'notifications',
  // Новые домены — В КОНЦЕ: порядок сохраняет приоритет буквальных маршрутов
  // писем (`/dictionaries/document-kind/items` побеждает общий словарный).
  'custom-fields',
  'dictionaries',
  'crm',
  // Матрица «Права доступа» (#379): UI-чекпоинт до бэкенда на живом входе.
  'roles',
  // Настройки портала (#558): файловые серверы; страница админа на моках.
  'settings',
  // ИИ-ассистент (#889): окно диалога и настройки провайдеров на моках —
  // демо работает без ключей и без бэкенда.
  'assistant',
  // Единый поиск (#952): P1 — окно на моках до бэкенда P2.
  'search',
  // Сохранённые настройки списков и выгрузка CSV (#435).
  'views',
] as const;

export type ApiMockDomain = (typeof API_MOCK_DOMAINS)[number];

export interface ApiMockConfig {
  /** false — MSW-воркер не стартует вовсе (полностью живой API). */
  enabled: boolean;
  /** 'all' — все домены (демо); иначе — множество ещё мокаемых доменов. */
  domains: ReadonlySet<ApiMockDomain> | 'all';
}

const LIVE: ApiMockConfig = { enabled: false, domains: new Set<ApiMockDomain>() };

/** Опечатка в списке предупреждает один раз на сессию: флаг читается при
 *  каждом isDomainMocked — спамить консоль на каждый запрос нельзя. */
let unknownDomainWarned = false;

export function parseApiMockEnv(raw: string | undefined): ApiMockConfig {
  const value = raw?.trim().toLowerCase() ?? '';
  if (value === '' || value === 'false') {
    return LIVE;
  }
  if (value === 'true') {
    return { enabled: true, domains: 'all' };
  }
  const domains = new Set<ApiMockDomain>();
  for (const part of value.split(',')) {
    const domain = part.trim();
    if (domain === '') continue; // «auth,, chat» — пустые элементы игнорируем
    if ((API_MOCK_DOMAINS as readonly string[]).includes(domain)) {
      domains.add(domain as ApiMockDomain);
    } else if (!unknownDomainWarned) {
      unknownDomainWarned = true;
      console.warn(
        `[nodus] VITE_API_MOCK: неизвестный домен «${domain}» — игнорируется. ` +
          `Известные: ${API_MOCK_DOMAINS.join(', ')}`,
      );
    }
  }
  return { enabled: domains.size > 0, domains };
}

/** Конфиг текущей сборки (VITE_* — build-time; читается на вызов для тестируемости). */
export function getApiMockConfig(): ApiMockConfig {
  return parseApiMockEnv(import.meta.env.VITE_API_MOCK as string | undefined);
}

/** Мокается ли домен: воркер запущен и домен в списке (или демо 'all'). */
export function isDomainMocked(domain: ApiMockDomain): boolean {
  const config = getApiMockConfig();
  if (!config.enabled) return false;
  return config.domains === 'all' || config.domains.has(domain);
}
