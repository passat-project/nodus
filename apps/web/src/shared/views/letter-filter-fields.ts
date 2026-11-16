import { useMemo } from 'react';
import type { LetterBox, LetterListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { projectsAvailable } from '../api/projects-available.js';
import { useUsersList } from '../api/users-list.js';
import { useAuthStore } from '../auth-store.js';
import { isResponseOverdue } from './letter-table-fields.js';
import type { FilterFieldDef, FilterOption, FilterValue } from './list-filters.js';
import { usePortfolioFilterDef } from './portfolio-filter-fields.js';
import type { FilterPreset } from './use-list-toolbar.js';

/** Локальный поиск письма (вкладка «Письма» контрагента; журналы ищут на
 *  сервере по тем же полям): №, тема, их №, корреспондент. */
export const letterSearchText = (letter: LetterListItem) =>
  [letter.regNumber, letter.subject, letter.theirNumber, letter.counterparty?.name]
    .filter(Boolean)
    .join(' ');

/** Проект письма — для фильтра «Портфель» (#559); ссылка стабильна, чтобы
 *  реестр фильтров не пересобирался каждый рендер. */
const letterProjectIdOf = (letter: LetterListItem) => letter.project?.id ?? null;

/** Встроенные пресеты журналов писем (левая колонка панели фильтра). */
export const letterBuiltinPresets: FilterPreset[] = [
  { id: 'mine', name: ui.letters.list.presetMine, state: { mine: 'yes' } },
  { id: 'overdue', name: ui.letters.list.presetOverdue, state: { overdue: 'yes' } },
];

const yesOption: FilterOption[] = [{ value: 'yes', label: ui.filters.yes }];

/** Календарный день (ISO-дата) в диапазоне фильтра. */
function dayInRange(day: string | null, value: FilterValue): boolean {
  if (typeof value !== 'object' || value === undefined) return true;
  if (!day) return false;
  if (value.from && day < value.from) return false;
  if (value.to && day > value.to) return false;
  return true;
}

/** Варианты из загруженных строк, значение — сама подпись: чип фильтра
 *  читается до загрузки строк (не мигает идентификатором), одноимённые
 *  значения разных типов писем сливаются — для фильтра это и нужно. */
function namesOf(
  rows: readonly LetterListItem[],
  pick: (letter: LetterListItem) => string | null | undefined,
): FilterOption[] {
  const names = new Set<string>();
  for (const row of rows) {
    const name = pick(row);
    if (name) names.add(name);
  }
  return [...names]
    .sort((a, b) => a.localeCompare(b, 'ru'))
    .map((name) => ({ value: name, label: name }));
}

/** Стадии — по ходу маршрута, не по алфавиту. */
function stageOptions(rows: readonly LetterListItem[]): FilterOption[] {
  const orders = new Map<string, number>();
  for (const { stage } of rows) {
    orders.set(stage.name, Math.min(orders.get(stage.name) ?? stage.order, stage.order));
  }
  return [...orders].sort((a, b) => a[1] - b[1]).map(([name]) => ({ value: name, label: name }));
}

/** Проекты — значение id (шифр может отсутствовать у «темы»), подпись
 *  «шифр имя» либо имя. */
function projectOptions(rows: readonly LetterListItem[]): FilterOption[] {
  const names = new Map<string, { code: string | null; name: string }>();
  for (const { project } of rows) {
    if (project) names.set(project.id, { code: project.code, name: project.name });
  }
  return [...names]
    .sort((a, b) => (a[1].code ?? a[1].name).localeCompare(b[1].code ?? b[1].name, 'ru'))
    .map(([id, { code, name }]) => ({ value: id, label: code ? `${code} ${name}` : name }));
}

/**
 * Реестр фильтруемых полей писем (стандарт списков; фильтрация клиентская по
 * загруженным страницам, поиск — серверный): статус, корреспондент (в
 * карточке контрагента скрыт), адресат, даты регистрации и срока ответа,
 * способ поступления, проект; скрытые служебные — пресеты «Мне адресованы»
 * и «Срок ответа истёк». `rows` — строки сервера (без локального фильтра).
 */
export function useLetterFilterDefs(
  rows: readonly LetterListItem[],
  { counterpartyVisible = true, box }: { counterpartyVisible?: boolean; box?: LetterBox } = {},
): FilterFieldDef<LetterListItem>[] {
  const { data: users } = useUsersList();
  const meId = useAuthStore((s) => s.user?.id);
  // Портфель — папка журнала «Проекты» (#559): появляется там же, где проект.
  const projectsShown = projectsAvailable('letters');
  const portfolioDef = usePortfolioFilterDef({
    projectIdOf: letterProjectIdOf,
    visible: projectsShown,
  });
  // Очередь «Новые» (редизайн #56): письма без регистрации — статус один
  // («Новое»), дат регистрации и сроков ответа нет вовсе: фильтр по ним
  // дал бы только пустой список (ловушка), поэтому поля очереди — кто
  // принёс, кому назначено и как поступило.
  const fresh = box === 'new';

  return useMemo(() => {
    const defs: FilterFieldDef<LetterListItem>[] = [
      ...(fresh
        ? []
        : [
            {
              id: 'stage',
              label: ui.letters.fields.stage,
              type: 'select',
              options: stageOptions(rows),
              match: (letter, v) => letter.stage.name === v,
            } as FilterFieldDef<LetterListItem>,
          ]),
      {
        id: 'addressee',
        label: ui.letters.fields.addressee,
        type: 'person',
        options: (users?.items ?? []).map((user) => ({
          value: user.id,
          label: user.displayName,
          avatarUrl: user.avatarUrl ?? null,
        })),
        match: (letter, v) => letter.addressee?.id === v,
      },
      ...(fresh
        ? []
        : [
            {
              id: 'regDate',
              label: ui.letters.fields.regDate,
              type: 'dateRange',
              match: (letter, v) => dayInRange(letter.regDate, v),
            } as FilterFieldDef<LetterListItem>,
            {
              id: 'responseDeadline',
              label: ui.letters.fields.responseDeadline,
              type: 'dateRange',
              match: (letter, v) => dayInRange(letter.responseDeadline, v),
            } as FilterFieldDef<LetterListItem>,
          ]),
      {
        id: 'receiptMethod',
        label: ui.letters.fields.receiptMethod,
        type: 'select',
        options: namesOf(rows, (letter) => letter.receiptMethod?.name),
        match: (letter, v) => letter.receiptMethod?.name === v,
      },
      ...(projectsShown
        ? [
            {
              id: 'project',
              label: ui.letters.fields.project,
              type: 'select',
              options: projectOptions(rows),
              match: (letter, v) => letter.project?.id === v,
            } as FilterFieldDef<LetterListItem>,
            ...(portfolioDef ? [portfolioDef] : []),
          ]
        : []),
      ...(fresh
        ? []
        : [
            {
              id: 'mine',
              label: ui.letters.list.presetMine,
              type: 'select',
              hidden: true,
              options: yesOption,
              match: (letter, v) =>
                v !== 'yes' || (meId !== undefined && letter.addressee?.id === meId),
            } as FilterFieldDef<LetterListItem>,
            {
              id: 'overdue',
              label: ui.letters.list.presetOverdue,
              type: 'select',
              hidden: true,
              options: yesOption,
              match: (letter, v) => v !== 'yes' || isResponseOverdue(letter),
            } as FilterFieldDef<LetterListItem>,
          ]),
    ];
    if (counterpartyVisible) {
      defs.splice(fresh ? 0 : 1, 0, {
        id: 'counterparty',
        label: ui.letters.fields.counterparty,
        type: 'select',
        options: namesOf(rows, (letter) => letter.counterparty?.name),
        match: (letter, v) => letter.counterparty?.name === v,
      });
    }
    return defs;
  }, [rows, users, meId, counterpartyVisible, fresh, projectsShown, portfolioDef]);
}
