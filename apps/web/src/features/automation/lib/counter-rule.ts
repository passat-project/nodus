import {
  numberContainerKey,
  numberContainerReachable,
  numberCreateTriggerProblem,
  numberPeriodsAllowed,
  renderNumberTemplate,
  ui,
  type NumberContainer,
  type NumberContainerKind,
  type NumberHostKind,
  type NumberMoment,
  type NumberSeriesRule,
  type NumberTemplateSegment,
} from '@nodus/contracts';

/**
 * Правило счётчика в окне (#630, модель v3): дефолт, пример
 * последовательности, сводка-предложение, совместимость «кто получает ×
 * отдельно для» и допустимость «при создании». Чистые функции — окно и
 * тесты читают одно и то же.
 */

/** Дефолт: сквозная, никогда не заново, вид «{Номер}», новый счёт с 1, шаг 1. */
export const DEFAULT_COUNTER_RULE: NumberSeriesRule = {
  containers: [],
  period: 'none',
  template: [{ kind: 'counter' }],
  startValue: 1,
  step: 1,
};

const counter = ui.customFields.dialog.counter;

/** Части момента по Минску — как `COMPANY_TIMEZONE` сервера. */
export function minskMoment(now: Date = new Date()): NumberMoment {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
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

/** Первый момент следующего периода (для примера «как пойдут номера»). */
function nextPeriodMoment(rule: NumberSeriesRule, at: NumberMoment): NumberMoment | null {
  switch (rule.period) {
    case 'year':
      return { year: at.year + 1, month: 1, day: 1 };
    case 'quarter': {
      const month = Math.ceil(at.month / 3) * 3 + 1;
      return month > 12 ? { year: at.year + 1, month: 1, day: 1 } : { ...at, month, day: 1 };
    }
    case 'month':
      return at.month === 12
        ? { year: at.year + 1, month: 1, day: 1 }
        : { ...at, month: at.month + 1, day: 1 };
    case 'day': {
      const next = new Date(Date.UTC(at.year, at.month - 1, at.day + 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
    }
    case 'none':
      return null;
  }
}

const BOUNDARY: Record<NumberSeriesRule['period'], string> = {
  none: '',
  year: counter.sequenceNewYear,
  quarter: counter.sequenceNewQuarter,
  month: counter.sequenceNewMonth,
  day: counter.sequenceNewDay,
};

/** «Как пойдут номера»: три подряд (с шагом) и, если счёт начинается
 *  заново, первый номер нового периода — администратор видит последствие. */
export function counterSequence(
  rule: NumberSeriesRule,
  next: number | null = null,
  now: Date = new Date(),
): SequenceItem[] {
  const at = minskMoment(now);
  const first = next ?? rule.startValue;
  const items: SequenceItem[] = [0, 1, 2].map((offset) => ({
    display: render(rule.template, first + offset * rule.step, at),
  }));
  const after = nextPeriodMoment(rule, at);
  if (after) {
    items.push({
      boundary: BOUNDARY[rule.period],
      display: render(rule.template, rule.startValue, after),
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

/** Значение селекта условия: `folder:<id>`, `field:<n>`, иначе вид. */
export const containerKey = numberContainerKey;

export function containerOf(key: string): NumberContainer {
  if (key.startsWith('folder:')) return { kind: 'folder', nodeKindId: key.slice(7) };
  if (key.startsWith('field:')) return { kind: 'field', fieldNumber: Number(key.slice(6)) };
  return {
    kind: key as Exclude<NumberContainerKind, 'folder' | 'field'>,
  } as NumberContainer;
}

/** Имена для подписей условий: вид папки и атрибут по номеру. */
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

/** Условия одной фразой: «сквозная нумерация» или «свой счёт для каждой
 *  папки «Здание» и каждого значения «Марка»». */
export function containersShort(
  containers: readonly NumberContainer[],
  names: ContainerNames,
): string {
  if (containers.length === 0) return counter.containersShort.company;
  const list = containers
    .map((container) => containerShort(container, names))
    .join(` ${counter.containerAnd} `);
  return fill(counter.containersShortLead, { list });
}

/** Сводка правила в одну строку: «свой счёт для каждой папки «Комплект»,
 *  заново каждый год» — панель кнопки и «Текущие счета». */
export function ruleShort(rule: NumberSeriesRule, names: ContainerNames): string {
  return `${containersShort(rule.containers, names)}${counter.periodsShort[rule.period]}`;
}

/** Почему тип не может получать номер при таком условии (null — может). */
export function unreachableReason(
  containers: readonly NumberContainer[],
  host: NumberHostKind,
): string | null {
  if (containers.every((container) => numberContainerReachable(container, host))) return null;
  if (host === 'letter') return counter.unreachable.letter;
  if (host === 'project') return counter.unreachable.project;
  if (host === 'node') return counter.unreachable.node;
  return counter.unreachable.generic;
}

/** Почему этому типу нельзя «при создании» (null — можно): письмо с почты
 *  приходит без проекта и полей. */
export function createTriggerReason(rule: NumberSeriesRule, host: NumberHostKind): string | null {
  const problem = numberCreateTriggerProblem(rule, host);
  if (problem === 'letter_place') return counter.triggerLetterPlace;
  if (problem === 'letter_fields') return counter.triggerLetterFields;
  return null;
}
