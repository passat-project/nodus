import type { Gender, UpdateMyProfileDto, UpdateUserDto, UserCard } from '@nodus/contracts';

/**
 * Черновик окна профиля (#923): все редактируемые поля одной формы, а на
 * сохранение уходят ТОЛЬКО изменённые. Разделение патчей повторяет матрицу
 * владельца: сотрудник правит себя через `PATCH /directory/users/me`
 * (ФИО + личные/контактные поля), админ — карточку через
 * `PATCH /directory/users/:id` (плюс HR-поля и структура). Руководитель
 * в черновике отсутствует — он производный.
 */
export interface ProfileDraft {
  lastName: string;
  firstName: string;
  middleName: string;
  mobilePhone: string;
  city: string;
  officeLocation: string;
  isRemote: boolean;
  gender: Gender | null;
  birthDate: string;
  workdayStart: string;
  workRate: string;
  hiredAt: string;
  departmentId: string | null;
  positionId: string | null;
}

/** Черновик из карточки: пустая строка — «не задано» для текстовых/датных. */
export function draftOf(card: UserCard): ProfileDraft {
  return {
    lastName: card.lastName,
    firstName: card.firstName,
    middleName: card.middleName ?? '',
    mobilePhone: card.mobilePhone ?? '',
    city: card.city ?? '',
    officeLocation: card.officeLocation ?? '',
    isRemote: card.isRemote,
    gender: card.gender,
    birthDate: card.birthDate ?? '',
    workdayStart: card.workdayStart ?? '',
    workRate: card.workRate === null ? '' : String(card.workRate),
    hiredAt: card.hiredAt ?? '',
    departmentId: card.departmentId,
    positionId: card.positionId,
  };
}

/** Пустой текст → null (сервер хранит «не задано» как null, не ''). */
function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function dateOrNull(value: string): string | null {
  return value.trim().length === 0 ? null : value;
}

function rateOf(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Изменившиеся self-поля (схема `updateMyProfileSchema`). */
function selfPatchOf(card: UserCard, draft: ProfileDraft): UpdateMyProfileDto {
  const patch: UpdateMyProfileDto = {};
  const lastName = draft.lastName.trim();
  const firstName = draft.firstName.trim();
  if (lastName !== card.lastName) patch.lastName = lastName;
  if (firstName !== card.firstName) patch.firstName = firstName;
  const middleName = textOrNull(draft.middleName);
  if (middleName !== card.middleName) patch.middleName = middleName;
  const mobilePhone = textOrNull(draft.mobilePhone);
  if (mobilePhone !== card.mobilePhone) patch.mobilePhone = mobilePhone;
  const city = textOrNull(draft.city);
  if (city !== card.city) patch.city = city;
  const officeLocation = textOrNull(draft.officeLocation);
  if (officeLocation !== card.officeLocation) patch.officeLocation = officeLocation;
  if (draft.isRemote !== card.isRemote) patch.isRemote = draft.isRemote;
  if (draft.gender !== card.gender) patch.gender = draft.gender;
  const birthDate = dateOrNull(draft.birthDate);
  if (birthDate !== card.birthDate) patch.birthDate = birthDate;
  const workdayStart = textOrNull(draft.workdayStart);
  if (workdayStart !== card.workdayStart) patch.workdayStart = workdayStart;
  return patch;
}

/** Изменившиеся admin-поля карточки (`PATCH /directory/users/:id`). */
function adminPatchOf(card: UserCard, draft: ProfileDraft, withSelf: boolean): UpdateUserDto {
  const patch: UpdateUserDto = {};
  if (withSelf) Object.assign(patch, selfPatchOf(card, draft));
  const workRate = rateOf(draft.workRate);
  if (workRate !== card.workRate) patch.workRate = workRate;
  const hiredAt = dateOrNull(draft.hiredAt);
  if (hiredAt !== card.hiredAt) patch.hiredAt = hiredAt;
  if (draft.departmentId !== card.departmentId) patch.departmentId = draft.departmentId;
  if (draft.positionId !== card.positionId) patch.positionId = draft.positionId;
  return patch;
}

/**
 * Патчи сохранения. `self` — окно своей карточки: сотрудник шлёт себя через
 * `/me`, администратор дополнительно структуру/HR через карточку. Не своя
 * карточка — только админ-патч (все изменённые поля одной ручкой).
 */
export function buildProfilePatches(
  card: UserCard,
  draft: ProfileDraft,
  options: { self: boolean; manage: boolean },
): { selfPatch: UpdateMyProfileDto; adminPatch: UpdateUserDto } {
  if (!options.self) {
    return { selfPatch: {}, adminPatch: adminPatchOf(card, draft, true) };
  }
  return {
    selfPatch: selfPatchOf(card, draft),
    adminPatch: options.manage ? adminPatchOf(card, draft, false) : {},
  };
}
