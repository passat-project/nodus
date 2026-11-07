import {
  renderNumberTemplate,
  type NumberScopeKind,
  type NumberSeriesRule,
} from '@nodus/contracts';

/**
 * Правило серии counter-атрибута (#630, Р6): дефолт и заготовки разреза.
 * Черновик окна атрибута держит правило всегда (у не-счётчиков оно
 * игнорируется), отправляется — только при type='counter'.
 */

/** Дефолт правила (§4c): общий разрез, сквозной счёт, вид «{Номер}»,
 *  старт 1, без добивки. */
export const DEFAULT_COUNTER_RULE: NumberSeriesRule = {
  scopeKind: 'none',
  scopeFormula: null,
  period: 'none',
  template: [{ kind: 'counter' }],
  startValue: 1,
};

/** Заготовки разреза селекта диалога (В2: абстрактная автоматизация —
 *  пресеты лишь примеры, произвольный разрез собирается формулой). */
export const COUNTER_SCOPE_PRESETS: readonly NumberScopeKind[] = [
  'none',
  'self',
  'project',
  'portfolio',
  'folder',
  'formula',
];

/** Пример номера для предпросмотра: следующий номер по правилу (старт —
 *  как первый номер новой группы), момент — текущий по Минску. */
export function counterPreviewOf(rule: NumberSeriesRule, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? 0);
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? 0);
  return renderNumberTemplate(rule.template, {
    seq: rule.startValue,
    year,
    month,
    field: () => '…',
  });
}
