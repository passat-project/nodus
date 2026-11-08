import {
  numberContainerReachable,
  numberPeriodsAllowed,
  renderNumberTemplate,
  ui,
  type NumberContainer,
  type NumberHostKind,
  type NumberMoment,
  type NumberSeriesRule,
  type NumberTemplateSegment,
} from '@nodus/contracts';

/**
 * Правило счётчика в окне атрибута (#630, концепция 08.11): дефолт, пример
 * последовательности, сводка-предложение и совместимость «кто получает ×
 * внутри чего». Чистые функции — окно и тесты читают одно и то же.
 */

/** Дефолт: вся компания, никогда не заново, вид «{Номер}», новый счёт с 1. */
export const DEFAULT_COUNTER_RULE: NumberSeriesRule = {
  container: { kind: 'company' },
  period: 'none',
  template: [{ kind: 'counter' }],
  startValue: 1,
};

const counter = ui.customFields.dialog.counter;

/** Части момента по Минску — как `COMPANY_TIMEZONE` сервера. */
export function minskMoment(now: Date = new Date()): NumberMoment {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value ?? 0),
    month: Number(parts.find((p) => p.type === 'month')?.value ?? 0),
  };
}

const render = (template: readonly NumberTemplateSegment[], seq: number, at: NumberMoment) =>
  renderNumberTemplate(template, { seq, ...at, field: () => '…' });

export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** Пример номера: следующий номер нового счёта (или заданный следующий). */
export function counterPreviewOf(
  rule: NumberSeriesRule,
  next: number | null = null,
  now: Date = new Date(),
): string {
  return render(rule.template, next ?? rule.startValue, minskMoment(now));
}

export interface SequenceItem {
  display: string;
  /** Подпись перед номером: «1 января» — счёт начался заново. */
  boundary?: string;
}

/** «Как пойдут номера»: три подряд и, если счёт начинается заново, первый
 *  номер нового периода — администратор видит последствие настройки. */
export function counterSequence(
  rule: NumberSeriesRule,
  next: number | null = null,
  now: Date = new Date(),
): SequenceItem[] {
  const at = minskMoment(now);
  const first = next ?? rule.startValue;
  const items: SequenceItem[] = [0, 1, 2].map((offset) => ({
    display: render(rule.template, first + offset, at),
  }));
  if (rule.period === 'year') {
    items.push({
      boundary: counter.sequenceNewYear,
      display: render(rule.template, rule.startValue, { year: at.year + 1, month: 1 }),
    });
  } else if (rule.period === 'month') {
    const nextMonth =
      at.month === 12 ? { year: at.year + 1, month: 1 } : { ...at, month: at.month + 1 };
    items.push({
      boundary: counter.sequenceNewMonth,
      display: render(rule.template, rule.startValue, nextMonth),
    });
  }
  return items;
}

/** Правка вида номера сохраняет «заново» допустимым: убрали год — счёт
 *  больше не начинается заново каждый год (иначе номера лет совпали бы). */
export function withTemplate(
  rule: NumberSeriesRule,
  template: NumberTemplateSegment[],
): NumberSeriesRule {
  const allowed = numberPeriodsAllowed(template);
  const addedYear =
    !rule.template.some((s) => s.kind === 'year') && template.some((s) => s.kind === 'year');
  const period = allowed.includes(rule.period) ? rule.period : 'none';
  // Добавили «Год» в номер, который никогда не начинался заново, — самое
  // частое намерение «15-26»: заново каждый год (видно и меняется рядом).
  return { ...rule, template, period: addedYear && period === 'none' ? 'year' : period };
}

/** Значение селекта «Свой счёт внутри»: `folder:<id>`, `field:<n>`, kind. */
export function containerKey(container: NumberContainer): string {
  if (container.kind === 'folder') return `folder:${container.nodeKindId}`;
  if (container.kind === 'field') return `field:${container.fieldNumber}`;
  return container.kind;
}

export function containerOf(key: string): NumberContainer {
  if (key.startsWith('folder:')) return { kind: 'folder', nodeKindId: key.slice(7) };
  if (key.startsWith('field:')) return { kind: 'field', fieldNumber: Number(key.slice(6)) };
  return { kind: key as 'company' | 'project' | 'portfolio' | 'parent_task' };
}

/** Имена для подписей контейнера: вид папки и атрибут по номеру. */
export interface ContainerNames {
  nodeKind: (id: string) => string | undefined;
  field: (fieldNumber: number) => string | undefined;
}

function nameOf(container: NumberContainer, names: ContainerNames): string {
  if (container.kind === 'folder') return names.nodeKind(container.nodeKindId) ?? '—';
  if (container.kind === 'field') return names.field(container.fieldNumber) ?? '—';
  return '';
}

export function containerLabel(container: NumberContainer, names: ContainerNames): string {
  return fill(counter.containers[container.kind], { name: nameOf(container, names) });
}

export function containerShort(container: NumberContainer, names: ContainerNames): string {
  return fill(counter.containersShort[container.kind], { name: nameOf(container, names) });
}

export function containerPath(container: NumberContainer, names: ContainerNames): string {
  return fill(counter.containerPath[container.kind], { name: nameOf(container, names) });
}

/** Сводка правила в одну строку: «свой счёт в каждой папке «Комплект»,
 *  заново каждый год» — панель кнопки и «Текущие счета». */
export function ruleShort(rule: NumberSeriesRule, names: ContainerNames): string {
  return `${containerShort(rule.container, names)}${counter.periodsShort[rule.period]}`;
}

/** Почему тип не может получать номер при таком «внутри чего» (null — может). */
export function unreachableReason(container: NumberContainer, host: NumberHostKind): string | null {
  if (numberContainerReachable(container, host)) return null;
  if (host === 'letter') return counter.unreachable.letter;
  if (host === 'project') return counter.unreachable.project;
  if (host === 'node') return counter.unreachable.node;
  return counter.unreachable.generic;
}
