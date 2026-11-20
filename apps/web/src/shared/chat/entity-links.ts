/** Парсер ссылок на сущности в тексте сообщений (модель v2 корреспонденции,
 *  вердикт владельца 22.09.2026: пересылка писем запрещена — вместо неё
 *  ссылка, которая разворачивается в чате карточкой-превью).
 *
 *  Распознаются две формы:
 *  - канонический URI сущности `portal://<вид>/<uuid>` (api-conventions);
 *  - веб deep-link стека карточек `…?cards=<вид>:<uuid>,…` (to, что копирует
 *    «Копировать ссылку» меню строк/карточек — card-link.ts).
 *  Парсер вид-независим: какие виды разворачивать превью — решает реестр
 *  link-previews (фичи регистрируют свои компоненты). */

import { ENTITY_ID_PATTERN } from '../lib/entity-id.js';

const LINK_RE = new RegExp(
  `portal://([a-z_]+)/(${ENTITY_ID_PATTERN})|https?://\\S*cards=\\S*`,
  'g',
);
const CARD_REF_RE = new RegExp(`([a-z_]+):(${ENTITY_ID_PATTERN})`, 'g');

export type MessageSegment =
  { kind: 'text'; value: string } | { kind: 'entity'; entity: string; id: string };

/** Разбить текст на текстовые сегменты и сущности-ссылки (сырые URI из
 *  текста убираются — их заменит превью). Пустых текстовых сегментов нет. */
export function parseEntityLinks(text: string): MessageSegment[] {
  if (!text.includes('portal://') && !text.includes('cards=')) {
    return [{ kind: 'text', value: text }];
  }
  const segments: MessageSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, start) });
    const [raw, portalKind, portalId] = match;
    if (portalKind && portalId) {
      segments.push({ kind: 'entity', entity: portalKind, id: portalId });
    } else {
      // Deep-link стека: пары «вид:id» из ?cards= (стек может быть глубже 1 —
      // превью получит каждая сущность). URL без валидных пар остаётся текстом.
      const cards = raw.slice(raw.indexOf('cards=') + 'cards='.length);
      const refs = [...cards.matchAll(CARD_REF_RE)];
      if (refs.length === 0) segments.push({ kind: 'text', value: raw });
      for (const ref of refs) {
        segments.push({ kind: 'entity', entity: ref[1] as string, id: ref[2] as string });
      }
    }
    cursor = start + raw.length;
  }
  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
  return segments.filter((s) => s.kind !== 'text' || s.value.length > 0);
}
