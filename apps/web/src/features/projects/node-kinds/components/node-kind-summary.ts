import type { NodeKind, ProjectType } from '@nodus/contracts';
import { kindAllowedByType, nodeKindFormOf, ui, formSlots } from '@nodus/contracts';

import { plural } from '../../../../shared/lib/format.js';

/** Обязательные слоты формы типа (состояние «обязательно»). */
function requiredCount(kind: NodeKind): number {
  return formSlots(nodeKindFormOf(kind)).filter((slot) => slot.state === 'required').length;
}

/** Сводка формы для строки типа: «1 атрибут · обязательных: 1» (или «Папки
 *  этого типа спрашивают только название»). Код папки — обычный слот
 *  атрибута «Код», отдельной сводки шифра нет (ревизия #631). */
export function formSummary(kind: NodeKind): string {
  const form = nodeKindFormOf(kind);
  if (formSlots(form).length === 0) {
    return ui.nodeKinds.panel.formSummaryEmpty;
  }
  const parts: string[] = [fieldsCountLabel(kind)];
  const required = requiredCount(kind);
  if (required > 0) {
    parts.push(ui.nodeKinds.panel.fieldsRequired.replace('{count}', String(required)));
  }
  return parts.join(' · ');
}

/** Счётчик атрибутов формы в строке типа: «1 атрибут» (моно, тихо). */
export function fieldsCountLabel(kind: NodeKind): string {
  const count = formSlots(nodeKindFormOf(kind)).length;
  return `${count} ${plural(count, ui.nodeKinds.fieldsCount)}`;
}

/** Компактная сводка строки типа в странице «Какие папки здесь бывают»:
 *  та же форма, что у сводки типа — одно число и обязательные. */
export function kindRowSummary(kind: NodeKind): string {
  return formSummary(kind);
}

/** Подсказка шапки карточки типа папки (#857, п.1 правил): ГДЕ тип папки
 *  разрешён — имена живых типов проектов (`kindAllowedByType`), первые два
 *  плюс счётчик остальных; все — «во всех типах проектов», нигде — честная
 *  строка. Мета строки в колонке «Процессов» — счётчик (unified-meta, I6). */
export function kindUsageText(kind: NodeKind, projectTypes: readonly ProjectType[]): string {
  const alive = projectTypes.filter((project) => project.archivedAt === null);
  if (alive.length === 0) return '';
  const allowed = alive.filter((project) => kindAllowedByType(project.kindIds, kind.id));
  if (allowed.length === 0) return ui.automation.entry.usageNowhere;
  if (allowed.length === alive.length) return ui.automation.entry.usageEverywhere;
  const rest = allowed.length - 2;
  const names = allowed
    .slice(0, 2)
    .map((project) => project.name)
    .join(', ');
  return ui.automation.entry.usageIn.replace('{names}', rest > 0 ? `${names} +${rest}` : names);
}
