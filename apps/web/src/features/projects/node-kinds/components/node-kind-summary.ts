import type { NodeKind, NodeKindFieldState } from '@nodus/contracts';
import { nodeKindFormOf, ui } from '@nodus/contracts';

import { plural } from '../../../../shared/lib/format.js';

/** Подписи состояний слота формы вида (#556): «Скрыто / По желанию /
 *  Обязательно» — одни на панель вида, окно создания и свойства папки. */
export const FIELD_STATES: readonly NodeKindFieldState[] = ['hidden', 'optional', 'required'];

export function stateOptions() {
  return FIELD_STATES.map((value) => ({ value, label: ui.nodeKinds.form.state[value] }));
}

/** Обязательные слоты формы вида (состояние «обязательно»). */
function requiredCount(kind: NodeKind): number {
  return nodeKindFormOf(kind).fields.filter((slot) => slot.state === 'required').length;
}

/** Сводка формы для строки-ссылки панели: «1 атрибут · обязательных: 1»
 *  (или «Папки этого вида спрашивают только название»). Код папки — обычный
 *  слот атрибута «Код», отдельной сводки шифра нет (ревизия #631). */
export function formSummary(kind: NodeKind): string {
  const form = nodeKindFormOf(kind);
  if (form.fields.length === 0) {
    return ui.nodeKinds.panel.formSummaryEmpty;
  }
  const parts: string[] = [fieldsCountLabel(kind)];
  const required = requiredCount(kind);
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

/** Компактная сводка строки вида в «Настройках типа»: та же форма, что у
 *  строки-ссылки панели — одно число и обязательные, без расхождений. */
export function kindRowSummary(kind: NodeKind): string {
  return formSummary(kind);
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
