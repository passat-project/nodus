import type { BirthdayEntry, CompanyStats, HomeSummary } from '@nodus/contracts';

import { isoDateIn } from './dates.js';
import { demoUserListItems, userIds, userRef } from './users.js';
import { activeStaffCount } from '../../lib/staff-count.js';

/** Корпоративная витрина (моки дева): показатели компании, трудозатраты,
 *  дни рождения. Контракт — как реальный `GET /home/summary` (модуль home
 *  бэка); на живом контуре без данных блоки просто не рендерятся. */

export const demoStats: CompanyStats = {
  // Штат — из демо-справочника, а не литералом (#723): число меняется вместе
  // с моковым списком. Считаются только действующие — то же определение, что у
  // живого `/home/summary` (`status=active`): уволенные в штат не входят,
  // иначе карточка расходится со счётчиком раздела «Сотрудники».
  employeeCount: activeStaffCount(demoUserListItems),
  // Источников нет ни в бэке, ни в моках — честные нули, как живой
  // `/home/summary`; демо-числа не маскируются под реальные (вердикт 01.10, #723).
  projectsDone: 0,
  dataNodes: 0,
};

export const demoLabor: HomeSummary['labor'] = {
  weeks: [
    { label: 'Нед 32', hours: 612 },
    { label: 'Нед 33', hours: 648 },
    { label: 'Нед 34', hours: 701 },
    { label: 'Нед 35', hours: 684 },
    { label: 'Нед 36', hours: 742 },
    { label: 'Нед 37', hours: 693 },
  ],
  topOvertime: [
    { user: userRef(userIds.matorin), hours: 14 },
    { user: userRef(userIds.klevantovich), hours: 11 },
    { user: userRef(userIds.vinnichek), hours: 8 },
    { user: userRef(userIds.kuralenya), hours: 6 },
  ],
};

export const demoBirthdays: BirthdayEntry[] = [
  { user: userRef(userIds.karpovich), date: isoDateIn(0), isToday: true },
  { user: userRef(userIds.klimovich), date: isoDateIn(5), isToday: false },
];
