/**
 * Вкладки модуля «Сотрудники» (#768, вердикт владельца 12.11.2026):
 * «Список» (дефолт) и «Структура» (управленческая оргструктура).
 * Старые адреса нормализуются заменой URL: `?view=divisions` и
 * `?view=subordination` → `?view=structure`; `?view=settings` и неизвестный
 * `view` → «Список» (параметр снимается, остальные параметры — например
 * `cards` — сохраняются).
 */
export type EmployeesTab = 'list' | 'structure';

export function resolveEmployeesTab(view: string | undefined): EmployeesTab {
  return view === 'structure' || view === 'divisions' || view === 'subordination'
    ? 'structure'
    : 'list';
}

/** Канонический адрес вкладки: у «Списка» параметра view нет. */
export function employeesTabSearch(tab: EmployeesTab): Record<string, string> {
  return tab === 'structure' ? { view: 'structure' } : {};
}

/**
 * Нужна ли замена URL: возвращает каноническое значение `view` (undefined —
 * параметр снять) или null, если адрес уже канонический. `?view=list` —
 * допустимый синоним дефолта (старые закладки не дёргаем).
 */
export function canonicalEmployeesView(view: string | undefined): string | null | undefined {
  if (view === undefined || view === 'list' || view === 'structure') return null;
  return resolveEmployeesTab(view) === 'structure' ? 'structure' : undefined;
}
