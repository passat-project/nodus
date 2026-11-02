import type { NodeKind, NodeKindFieldState } from '@nodus/contracts';
import { nodeKindFormOf, ui } from '@nodus/contracts';

import { plural } from '../../../../shared/lib/format.js';

/** Подписи состояний слота формы вида (#556): «Скрыто / По желанию /
 *  Обязательно» — одни на панель вида, окно создания и свойства папки. */
export const FIELD_STATES: readonly NodeKindFieldState[] = ['hidden', 'optional', 'required'];

export function stateOptions() {
  return FIELD_STATES.map((value) => ({ value, label: ui.nodeKinds.form.state[value] }));
}

/** Сводка формы для строки-ссылки панели: «Шифр обязателен · 1 атрибут ·
 *  обязательных: 1» (или «Папки этого вида спрашивают только название»).
 *  Счётчики — те же подписи, что в строке вида: одно число — одна форма. */
export function formSummary(kind: NodeKind): string {
  const form = nodeKindFormOf(kind);
  if (form.fields.length === 0 && form.code === 'optional') {
    return ui.nodeKinds.panel.formSummaryEmpty;
  }
  const required = form.fields.filter((slot) => slot.state === 'required').length;
  const parts: string[] = [ui.nodeKinds.panel.codeSummary[form.code]];
  if (form.fields.length > 0) parts.push(fieldsCountLabel(kind));
  if (required > 0) {
    parts.push(ui.nodeKinds.panel.fieldsRequired.replace('{count}', String(required)));
  }
  return parts.join(' · ');
}

/** Счётчик атрибутов формы в строке вида: «1 атрибут» (моно, тихо). */
export function fieldsCountLabel(kind: NodeKind): string {
  const count = nodeKindFormOf(kind).fields.length;
  return `${count} ${plural(count, ui.nodeKinds.fieldsCount)}`;
}

/** Тот же счётчик коротко для узкой строки вида: «1 атр.». */
export function fieldsCountShort(kind: NodeKind): string {
  return `${nodeKindFormOf(kind).fields.length} ${ui.nodeKinds.fieldsCountShort}`;
}

/** Сводка возможностей для строки-ссылки: «Включено: 2» или «Нет». */
export function capabilitiesSummary(kind: NodeKind): string {
  const count = kind.capabilities.length;
  return count === 0
    ? ui.nodeKinds.panel.capabilitiesSummaryNone
    : ui.nodeKinds.panel.capabilitiesSummary.replace('{count}', String(count));
}
