import type { NodeKind, NodeKindFieldState } from '@nodus/contracts';
import { nodeKindFormOf, ui } from '@nodus/contracts';

import { plural } from '../../../../shared/lib/format.js';

/** Подписи состояний слота формы вида (#556): «Скрыто / По желанию /
 *  Обязательно» — одни на панель вида, окно создания и свойства папки. */
export const FIELD_STATES: readonly NodeKindFieldState[] = ['hidden', 'optional', 'required'];

export function stateOptions() {
  return FIELD_STATES.map((value) => ({ value, label: ui.nodeKinds.form.state[value] }));
}

/** Сводка формы для строки-ссылки панели: «Шифр обязателен · атрибутов 1,
 *  обязательных 1» (или «Папки этого вида спрашивают только название»). */
export function formSummary(kind: NodeKind): string {
  const form = nodeKindFormOf(kind);
  if (form.fields.length === 0 && form.code === 'optional') {
    return ui.nodeKinds.panel.formSummaryEmpty;
  }
  const required = form.fields.filter((slot) => slot.state === 'required').length;
  const fields = `${ui.nodeKinds.panel.fieldsSummary
    .replace('{count}', String(form.fields.length))
    .replace('{required}', String(required))}`;
  return `${ui.nodeKinds.panel.codeSummary[form.code]} · ${fields}`;
}

/** Счётчик атрибутов формы в строке вида: «1 атрибут» (моно, тихо). */
export function fieldsCountLabel(kind: NodeKind): string {
  const count = nodeKindFormOf(kind).fields.length;
  return `${count} ${plural(count, ui.nodeKinds.fieldsCount)}`;
}

/** Сводка возможностей для строки-ссылки: «Включено: 2» или «Нет». */
export function capabilitiesSummary(kind: NodeKind): string {
  const count = kind.capabilities.length;
  return count === 0
    ? ui.nodeKinds.panel.capabilitiesSummaryNone
    : ui.nodeKinds.panel.capabilitiesSummary.replace('{count}', String(count));
}
