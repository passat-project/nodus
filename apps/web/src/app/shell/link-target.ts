import { cardRefFromString, isCardId, parseCardStack, type CardRef } from './card-stack.js';

/** Куда ведёт ссылка из интерфейса портала (классификация для перехватчика).
 *
 *  - `cards` — внутренняя карточка стека (deep-link `?cards=…` или `portal://…`):
 *    открываем ВНУТРИ приложения, без браузера и новой вкладки;
 *  - `external` — внешний http(s): в десктоп-оболочке — системный браузер;
 *  - `system` — `mailto:`/`tel:`: системное приложение (почта/телефон);
 *  - `default` — всё остальное: штатное поведение браузера/навигации.
 *
 *  Функция чистая (задаётся base) — тестируется без DOM. */
export type LinkTarget =
  | { kind: 'default' }
  | { kind: 'cards'; cards: CardRef[] }
  | { kind: 'external'; url: string }
  | { kind: 'system'; url: string };

/** Канонический URI сущности `portal://<вид>/<id>` (api-conventions). */
const PORTAL_URI_RE = /^portal:\/\/([a-z_]+)\/(.+)$/i;

export function resolveLinkTarget(href: string, base: string): LinkTarget {
  const portal = PORTAL_URI_RE.exec(href);
  if (portal) {
    const id = portal[2]!;
    if (!isCardId(id)) return { kind: 'default' };
    const ref = cardRefFromString(`${portal[1]!.toLowerCase()}:${id}`);
    return ref ? { kind: 'cards', cards: [ref] } : { kind: 'default' };
  }

  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return { kind: 'default' };
  }

  if (url.protocol === 'mailto:' || url.protocol === 'tel:') {
    return { kind: 'system', url: url.href };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'default' };

  let baseOrigin: string;
  try {
    baseOrigin = new URL(base).origin;
  } catch {
    return { kind: 'default' };
  }
  if (url.origin !== baseOrigin) return { kind: 'external', url: url.href };

  // parseCardStack уже отбрасывает не-UUID id (#908): второй проверки нет.
  const cards = parseCardStack(url.searchParams.get('cards') ?? undefined);
  return cards.length > 0 ? { kind: 'cards', cards } : { kind: 'default' };
}
