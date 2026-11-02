import { Permission } from '@nodus/contracts';
import type { AuthUser, PresenceEntry, UserCard, UserListItem, UserRef } from '@nodus/contracts';

import { departmentIds } from './org-ids.js';

/** Демо-справочник сотрудников (ПассатПроект, 10 человек для концепта). */

const uid = (n: number): string => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const userIds = {
  klimovich: uid(1),
  polomar: uid(2),
  klevantovich: uid(3),
  voronina: uid(4),
  matorin: uid(5),
  karpovich: uid(6),
  shaiderova: uid(7),
  kuralenya: uid(8),
  vinnichek: uid(9),
  akulich: uid(10),
};

function mk(
  n: number,
  displayName: string,
  positionName: string,
  departmentName: string,
  manager: number | null,
  department: keyof typeof departmentIds,
  legalDepartment: keyof typeof departmentIds,
): UserListItem {
  const email = `user${n}@passatproekt.by`;
  return {
    id: uid(n),
    displayName,
    status: 'active',
    avatarUrl: null,
    positionName,
    departmentName,
    email,
    managerId: manager === null ? null : uid(manager),
    departmentId: departmentIds[department],
    legalDepartmentId: departmentIds[legalDepartment],
    positionId: null,
    legalPositionId: null,
  };
}

/** Демо-принадлежность и подчинённость (#84): управленчески инженерный состав
 *  сидит в BIM-отделе/Проектном, юридически по трудовой — в «Группе ГИПов»;
 *  Воронина — помощник ГИПа Клевантовича (managerId 3) при управленческом
 *  руководителе Климовиче: иерархия внутри юргруппы без фиктивных отделов. */
export const demoUserListItems: UserListItem[] = [
  mk(1, 'Александр Климович', 'БИМ-менеджер', 'BIM-отдел', 7, 'bim', 'legalGip'),
  mk(2, 'Екатерина Поломар', 'Инженер-проектировщик', 'BIM-отдел', 1, 'bim', 'legalGip'),
  mk(3, 'Денис Клевантович', 'Главный специалист BIM', 'BIM-отдел', 1, 'bim', 'legalGip'),
  mk(4, 'Алина Воронина', 'Инженер-проектировщик', 'BIM-отдел', 3, 'bim', 'legalGip'),
  mk(5, 'Артём Маторин', 'Инженер-проектировщик', 'BIM-отдел', 1, 'bim', 'legalGip'),
  mk(6, 'Ольга Карпович', 'Специалист по кадрам', 'Административное', 7, 'admin', 'legalCompany'),
  mk(7, 'Валерия Шайдерова', 'Директор', 'ПассатПроект', null, 'company', 'legalCompany'),
  mk(8, 'Андрей Кураленя', 'Инженер-проектировщик', 'Проектное', 9, 'project', 'legalGip'),
  mk(9, 'Полина Винничек', 'Главный архитектор', 'Проектное', 7, 'project', 'legalGip'),
  mk(10, 'Михаил Акулич', 'Инженер-проектировщик', 'Проектное', 9, 'project', 'legalGip'),
];

/** Профильные поля карточки (контактный блок UserCard, модель M2 #18):
 *  ключ — порядковый номер демо-пользователя. */
type ProfilePart = Pick<
  UserCard,
  | 'mobilePhone'
  | 'city'
  | 'officeLocation'
  | 'isRemote'
  | 'workRate'
  | 'gender'
  | 'birthDate'
  | 'hiredAt'
  | 'workdayStart'
>;

const demoProfiles: Record<number, ProfilePart> = {
  1: {
    mobilePhone: '+375296751238',
    city: 'Минск',
    officeLocation: '7.3',
    isRemote: false,
    workRate: 1,
    gender: 'male',
    birthDate: '1990-04-06',
    hiredAt: '2021-12-13',
    workdayStart: '10:00',
  },
  2: {
    mobilePhone: '+375291144209',
    city: 'Минск',
    officeLocation: '7.3',
    isRemote: false,
    workRate: 1,
    gender: 'female',
    birthDate: '1995-08-19',
    hiredAt: '2022-03-01',
    workdayStart: '09:30',
  },
  3: {
    mobilePhone: '+375298830645',
    city: 'Минск',
    officeLocation: '7.4',
    isRemote: true,
    workRate: 1,
    gender: 'male',
    birthDate: '1988-01-27',
    hiredAt: '2020-06-15',
    workdayStart: '09:00',
  },
  4: {
    mobilePhone: '+375293390812',
    city: 'Минск',
    officeLocation: '7.3',
    isRemote: false,
    workRate: 1,
    gender: 'female',
    birthDate: '1997-11-02',
    hiredAt: '2023-09-04',
    workdayStart: '10:00',
  },
  5: {
    mobilePhone: '+375295521778',
    city: 'Минск',
    officeLocation: '7.4',
    isRemote: false,
    workRate: 1,
    gender: 'male',
    birthDate: '1996-05-14',
    hiredAt: '2022-10-17',
    workdayStart: '09:30',
  },
  6: {
    mobilePhone: '+375291177430',
    city: 'Минск',
    officeLocation: '5.1',
    isRemote: false,
    workRate: 1,
    gender: 'female',
    birthDate: '1992-02-23',
    hiredAt: '2019-04-08',
    workdayStart: '09:00',
  },
  7: {
    mobilePhone: '+375296600154',
    city: 'Минск',
    officeLocation: '4.1',
    isRemote: false,
    workRate: 1,
    gender: 'female',
    birthDate: '1985-07-30',
    hiredAt: '2016-02-01',
    workdayStart: '09:00',
  },
  8: {
    mobilePhone: '+375293344590',
    city: 'Минск',
    officeLocation: '6.2',
    isRemote: false,
    workRate: 1,
    gender: 'male',
    birthDate: '1994-09-09',
    hiredAt: '2021-05-24',
    workdayStart: '10:00',
  },
  9: {
    mobilePhone: '+375297701266',
    city: 'Минск',
    officeLocation: '6.1',
    isRemote: false,
    workRate: 1,
    gender: 'female',
    birthDate: '1989-12-05',
    hiredAt: '2018-08-13',
    workdayStart: '09:00',
  },
  10: {
    mobilePhone: '+375294488903',
    city: 'Минск',
    officeLocation: '6.2',
    isRemote: false,
    workRate: 1,
    gender: 'male',
    birthDate: '1998-03-21',
    hiredAt: '2024-01-15',
    workdayStart: '10:00',
  },
};

function splitName(displayName: string): {
  lastName: string;
  firstName: string;
  middleName: string | null;
} {
  const [firstName = displayName, lastName = ''] = displayName.split(' ');
  return { firstName, lastName, middleName: null };
}

/** Полные карточки демо-сотрудников (GET /directory/users/:id → UserCard):
 *  профиль из demoProfiles, орг-имена резолвятся списком на клиенте
 *  (departmentId/positionId — с бэкендом M2, в концепте null). */
export const demoUserCards: UserCard[] = demoUserListItems.map((item) => {
  const n = Number(item.id.slice(-12));
  const profile = demoProfiles[n];
  if (!profile) throw new Error(`Нет демо-профиля: ${item.id}`);
  return {
    id: item.id,
    email: item.email,
    displayName: item.displayName,
    status: item.status,
    ...splitName(item.displayName),
    managerId: item.managerId,
    departmentId: item.departmentId,
    positionId: null,
    legalDepartmentId: item.legalDepartmentId,
    legalPositionId: null,
    ...profile,
    avatarUrl: item.avatarUrl,
    roles: [],
    createdAt: `${profile.hiredAt}T09:00:00.000Z`,
    updatedAt: `${profile.hiredAt}T09:00:00.000Z`,
  };
});

export function userRef(id: string): UserRef {
  const item = demoUserListItems.find((u) => u.id === id);
  if (!item) throw new Error(`Неизвестный демо-пользователь: ${id}`);
  return { id: item.id, displayName: item.displayName, avatarUrl: item.avatarUrl };
}

const me = demoUserListItems.find((u) => u.id === userIds.klimovich);
if (!me) throw new Error('Демо-справочник: текущий пользователь не найден');

export const currentAuthUser: AuthUser = {
  id: me.id,
  email: me.email,
  displayName: me.displayName,
  // Мок-концепт: текущий пользователь — админ, галочка «Для всех» видна (#4);
  // стикеры (#143), редактор маршрутов (#378), реестр полей (#431) и матрица
  // прав (#379) — права UI-фазы на моках. Строк вне каталога Permission нет (I15/Р13).
  permissions: [
    Permission.TASK_CREATE,
    Permission.TASK_MANAGE_ANY,
    Permission.CORRESPONDENCE_REGISTER,
    Permission.CORRESPONDENCE_RESOLVE,
    Permission.SETTINGS_UI_DEFAULTS,
    Permission.STICKER_MANAGE,
    Permission.WORKFLOW_MANAGE,
    Permission.CUSTOM_FIELD_MANAGE,
    Permission.DICTIONARY_MANAGE,
    Permission.CRM_MANAGE,
    Permission.ROLE_MANAGE,
    // Проекты (#52): создаёт любой, управление/настройка — админ демо;
    // view_secret НЕ выдаётся — модель Битрикс-суперадмина видна в демо.
    Permission.PROJECT_CREATE,
    Permission.PROJECT_MANAGE,
    Permission.PROJECT_SETUP_MANAGE,
  ],
};

export const demoPresence: PresenceEntry[] = [
  // Текущий пользователь онлайн по определению — он прямо сейчас в портале.
  { user: userRef(userIds.klimovich), status: 'online' },
  { user: userRef(userIds.klevantovich), status: 'online' },
  { user: userRef(userIds.matorin), status: 'online' },
  { user: userRef(userIds.karpovich), status: 'online' },
  { user: userRef(userIds.vinnichek), status: 'online' },
  { user: userRef(userIds.akulich), status: 'online' },
  { user: userRef(userIds.polomar), status: 'online' },
  { user: userRef(userIds.voronina), status: 'away' },
  { user: userRef(userIds.shaiderova), status: 'offline' },
];
