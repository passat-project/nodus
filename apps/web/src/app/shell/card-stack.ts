/**
 * Стек карточек сущностей (ADR-0009) — типы и (де)сериализация URL.
 *
 * КАНОН: все карточки сущностей (задача, проект, письмо, сотрудник) —
 * ОДНОЙ геометрии (единый SliderPanel без уровней) и наслаиваются друг на
 * друга: открытие из карточки кладёт новую ПОВЕРХ, закрытие верхней
 * возвращает к предыдущей (та живая, состояние сохранено). Стек отражён в
 * search-параметре `?cards=task:<id>,project:<id>` — deep-link, восстановление
 * после F5, «назад» браузера = снять верхнюю карточку. Мессенджер — тоже
 * сущность стека (вердикт владельца 15.09.2026, план
 * `docs/mvp/archive/messenger-fullscreen-plan.md`): вид `messenger:<conversationId>` —
 * ПОЛНОЭКРАННАЯ карточка (перекрывает служебную полосу — дубль списка бесед
 * исчезает; закрыл — вернулся на карточку предыдущей сущности). id — беседа,
 * выбранная при открытии (клик по аватарке в полосе); подмена верхней
 * мессенджер-карточки меняет беседу без ремаунта панели.
 */

export type CardKind = 'task' | 'project' | 'letter' | 'employee' | 'counterparty' | 'messenger';

export interface CardRef {
  kind: CardKind;
  id: string;
}

const KINDS: readonly string[] = [
  'task',
  'project',
  'letter',
  'employee',
  'counterparty',
  'messenger',
];

/** «task:<id>» — компактная форма в URL. */
export function cardRefToString(ref: CardRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** id карточки — строгий UUID. Deep-link приходит из письма, чата и адресной
 *  строки (недоверенный вход), а клиентский GET карточки строится подстановкой
 *  id в путь API: `task:../directory/users` без проверки уводил запрос в чужой
 *  маршрут. Мусор отбрасывается так же, как неизвестный вид (#908). */
const CARD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCardId(value: string): boolean {
  return CARD_ID_RE.test(value);
}

export function cardRefFromString(raw: string): CardRef | null {
  const sep = raw.indexOf(':');
  if (sep <= 0) return null;
  const kind = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!KINDS.includes(kind) || !isCardId(id)) return null;
  return { kind: kind as CardKind, id };
}

/** Стек из search-параметра (строка «task:id,project:id»); мусор отбрасывается. */
export function parseCardStack(raw: unknown): CardRef[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw
    .split(',')
    .map(cardRefFromString)
    .filter((ref): ref is CardRef => ref !== null);
}

/** Сериализация стека; пустой стек → undefined (параметр исчезает из URL).
 *  Не-UUID id в URL не попадают и из внутренних вызовов (мост карточек):
 *  запись мусора в адрес = тот же недоверенный вход при следующем открытии. */
export function serializeCardStack(cards: readonly CardRef[]): string | undefined {
  const valid = cards.filter((ref) => KINDS.includes(ref.kind) && isCardId(ref.id));
  return valid.length > 0 ? valid.map(cardRefToString).join(',') : undefined;
}

export function sameCard(a: CardRef, b: CardRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}
