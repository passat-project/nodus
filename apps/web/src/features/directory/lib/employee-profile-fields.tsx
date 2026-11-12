import {
  Briefcase,
  Building2,
  CalendarCheck2,
  CalendarClock,
  Cake,
  DoorOpen,
  Laptop,
  Mail,
  MapPin,
  Phone,
  User,
  UserCheck,
  UserCog,
  Wallet,
  VenusAndMars,
} from 'lucide-react';
import type { UserCard, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import type { CardRef } from '../../../app/shell/card-stack.js';
import { formatDate } from '../../../shared/lib/format.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import type { EntityFieldDef } from '../../../shared/ui/entity-fields.js';
import { UserStatusChip } from './employee-fields.js';

const monoValue = 'font-mono text-label-sm tabular-nums';

/** Поля-реестр вкладки «Профиль» карточки сотрудника (полный UserCard):
 *  должность/подразделение (имена — из списка, id-справочники — с бэкендом
 *  M2), контакты (почта, телефон, город, кабинет, удалёнка), ставка, пол,
 *  HR-даты (день рождения, дата приёма, начало дня), руководитель — переход
 *  в его карточку стеком (openCard, ADR-0009), HR-статус. Видимость — «+
 *  Поле» (persist localStorage). */
export function employeeProfileDefs(args: {
  card: UserCard;
  listItem: UserListItem;
  manager: UserListItem | undefined;
  openCard: (ref: CardRef) => void;
}): EntityFieldDef[] {
  const { card, listItem, manager, openCard } = args;
  return [
    {
      // #132: отчество — ПОЛЕ карточки (в displayName его больше нет);
      // отображение отчеств в UI включается «Настройками портала» #133.
      key: 'middleName',
      icon: <User className="size-3.5" />,
      label: ui.employees.middleName,
      render: () => card.middleName ?? ui.common.notSet,
    },
    {
      key: 'position',
      icon: <Briefcase className="size-3.5" />,
      label: ui.employees.position,
      render: () => listItem.positionName ?? ui.common.notSet,
    },
    {
      key: 'department',
      icon: <Building2 className="size-3.5" />,
      label: ui.employees.department,
      render: () =>
        listItem.departmentName ? (
          <span className="text-sm text-info">{listItem.departmentName}</span>
        ) : (
          ui.common.notSet
        ),
    },
    {
      key: 'email',
      icon: <Mail className="size-3.5" />,
      label: ui.employees.email,
      render: () => <span className="text-sm">{card.email}</span>,
    },
    {
      key: 'phone',
      icon: <Phone className="size-3.5" />,
      label: ui.employees.fieldPhone,
      render: () =>
        card.mobilePhone ? <span className={monoValue}>{card.mobilePhone}</span> : ui.common.notSet,
    },
    {
      key: 'city',
      icon: <MapPin className="size-3.5" />,
      label: ui.employees.fieldCity,
      render: () => card.city ?? ui.common.notSet,
    },
    {
      key: 'office',
      icon: <DoorOpen className="size-3.5" />,
      label: ui.employees.fieldOffice,
      render: () =>
        card.officeLocation ? (
          <span className={monoValue}>{card.officeLocation}</span>
        ) : (
          ui.common.notSet
        ),
    },
    {
      key: 'remote',
      icon: <Laptop className="size-3.5" />,
      label: ui.employees.fieldRemote,
      render: () => (card.isRemote ? ui.employees.remoteYes : ui.employees.remoteNo),
    },
    {
      key: 'workRate',
      icon: <Wallet className="size-3.5" />,
      label: ui.employees.fieldWorkRate,
      render: () =>
        card.workRate !== null ? (
          <span className={monoValue}>{card.workRate}</span>
        ) : (
          ui.common.notSet
        ),
    },
    {
      key: 'gender',
      icon: <VenusAndMars className="size-3.5" />,
      label: ui.employees.fieldGender,
      render: () =>
        card.gender
          ? ui.employees[card.gender === 'male' ? 'genderMale' : 'genderFemale']
          : ui.common.notSet,
    },
    {
      key: 'birthDate',
      icon: <Cake className="size-3.5" />,
      label: ui.employees.fieldBirthDate,
      render: () =>
        card.birthDate ? (
          <span className={monoValue}>{formatDate(card.birthDate)}</span>
        ) : (
          ui.common.notSet
        ),
    },
    {
      key: 'hiredAt',
      icon: <CalendarCheck2 className="size-3.5" />,
      label: ui.employees.fieldHiredAt,
      render: () =>
        card.hiredAt ? (
          <span className={monoValue}>{formatDate(card.hiredAt)}</span>
        ) : (
          ui.common.notSet
        ),
    },
    {
      key: 'workdayStart',
      icon: <CalendarClock className="size-3.5" />,
      label: ui.employees.fieldWorkdayStart,
      render: () =>
        card.workdayStart ? (
          <span className={monoValue}>{card.workdayStart}</span>
        ) : (
          ui.common.notSet
        ),
    },
    {
      key: 'manager',
      icon: <UserCog className="size-3.5" />,
      label: ui.employees.fieldManager,
      render: () =>
        manager ? (
          <button
            type="button"
            onClick={() => openCard({ kind: 'employee', id: manager.id })}
            className="flex min-w-0 items-center gap-2 hover:underline"
          >
            <PersonAvatar name={manager.displayName} className="size-6 shrink-0" />
            <span className="truncate">{manager.displayName}</span>
          </button>
        ) : (
          ui.common.notSet
        ),
    },
    {
      key: 'status',
      icon: <UserCheck className="size-3.5" />,
      label: ui.employees.fieldStatus,
      render: () => <UserStatusChip status={card.status} />,
    },
  ];
}
