import type { Gender, UserCard, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Switch } from '@nodus/ui/components/switch';

import { useDepartmentsList } from '../../../shared/api/departments-list.js';
import { DateTimePicker } from '../../../shared/ui/date-time-picker.js';
import { localDateStr, parseIsoDate } from '../../../shared/ui/date-time-grid.js';
import { TimePicker } from '../../../shared/ui/time-picker.js';
import { usePositions } from '../api/directory-api.js';
import type { ProfileDraft } from '../lib/profile-draft.js';
import {
  ProfileField as Field,
  ProfileReadonlyValue as ReadonlyValue,
} from './employee-profile-dialog-field.js';
import { ProfileSectionHeading } from './profile-section-heading.js';

/** Sentinel Radix Select для «не выбрано» (пустая строка значением запрещена). */
const NONE = '__none__';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <ProfileSectionHeading label={title} />
      {children}
    </section>
  );
}

/** Поле и read-only значение окна вынесены в `employee-profile-dialog-field`
 *  (лимит файла I5); здесь — только секции и их контролы. */

/**
 * Секции окна профиля (#923) — чистый слой ввода: значения черновика живут в
 * диалоге, здесь только разметка и вызовы onChange. Сотрудник на своей
 * карточке видит структуру и HR-поля только для чтения; администратор правит
 * их здесь же (в «Действиях» структуры нет — решение владельца).
 */
export function ProfileDialogSections({
  card,
  draft,
  users,
  canManage,
  lastNameRef,
  autoSelectGuard,
  onChange,
}: {
  card: UserCard;
  draft: ProfileDraft;
  users: UserListItem[];
  canManage: boolean;
  /** Фокус окна — в «Фамилию» без выделения (паттерн окна подразделения). */
  lastNameRef?: React.RefObject<HTMLInputElement | null>;
  autoSelectGuard?: React.MutableRefObject<boolean>;
  onChange: (patch: Partial<ProfileDraft>) => void;
}) {
  const departments = useDepartmentsList();
  const positions = usePositions('management').data ?? [];
  const manager = card.managerId ? users.find((user) => user.id === card.managerId) : undefined;
  const set = (key: keyof ProfileDraft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ [key]: event.target.value });

  return (
    <div className="flex flex-col gap-6">
      <Section title={ui.employees.sectionPersonal}>
        <div className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-3">
          <Field label={ui.employees.fieldLastName}>
            <Input
              ref={lastNameRef}
              value={draft.lastName}
              onChange={set('lastName')}
              autoComplete="off"
              // FocusScope при возврате фокуса зовёт `element.select()`: снимаем
              // выделение следующим кадром, пока пользователь не начал работать.
              onFocus={(event) => {
                if (!autoSelectGuard?.current) return;
                const input = event.currentTarget;
                requestAnimationFrame(() => {
                  if (!autoSelectGuard.current || !input.isConnected) return;
                  if (input.selectionStart === 0 && input.selectionEnd === input.value.length) {
                    const end = input.value.length;
                    input.setSelectionRange(end, end);
                  }
                });
              }}
              // Программный `select()` Radix не всегда сопровождается focus:
              // ловим select-событие и снимаем полное выделение при открытии.
              onSelect={(event) => {
                if (!autoSelectGuard?.current) return;
                const input = event.currentTarget;
                if (input.selectionStart === 0 && input.selectionEnd === input.value.length) {
                  const end = input.value.length;
                  input.setSelectionRange(end, end);
                }
              }}
              onPointerDown={() => {
                if (autoSelectGuard) autoSelectGuard.current = false;
              }}
              onKeyDown={() => {
                if (autoSelectGuard) autoSelectGuard.current = false;
              }}
            />
          </Field>
          <Field label={ui.employees.fieldFirstName}>
            <Input value={draft.firstName} onChange={set('firstName')} autoComplete="off" />
          </Field>
          <Field label={ui.employees.middleName}>
            <Input value={draft.middleName} onChange={set('middleName')} autoComplete="off" />
          </Field>
        </div>
      </Section>

      <Section title={ui.employees.sectionContacts}>
        <div className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-2">
          <Field
            label={ui.employees.email}
            hint={ui.employees.emailLoginHint}
            hintShort={ui.employees.emailLoginTag}
          >
            {/* Логин — не disabled, а readOnly: значение читаемо и копируется,
                поле лишь не принимает ввод (заливка = «системное значение»). */}
            <Input
              value={card.email}
              readOnly
              className="cursor-default bg-secondary/50 text-foreground"
            />
          </Field>
          <Field label={ui.employees.fieldPhone}>
            <Input value={draft.mobilePhone} onChange={set('mobilePhone')} inputMode="tel" />
          </Field>
          <Field label={ui.employees.fieldCity}>
            <Input value={draft.city} onChange={set('city')} />
          </Field>
          <Field label={ui.employees.fieldOffice}>
            <Input value={draft.officeLocation} onChange={set('officeLocation')} />
          </Field>
        </div>
        <label className="flex min-h-8 items-center justify-between gap-3 rounded-lg bg-secondary/50 px-3 py-1">
          <span className="text-sm">{ui.employees.fieldRemote}</span>
          <Switch
            checked={draft.isRemote}
            onCheckedChange={(checked) => onChange({ isRemote: checked === true })}
            aria-label={ui.employees.fieldRemote}
          />
        </label>
      </Section>

      <Section title={ui.employees.sectionWork}>
        <div className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-2">
          {canManage ? (
            <Field label={ui.employees.fieldWorkRate}>
              <Input
                type="number"
                min={0}
                max={2}
                step={0.25}
                value={draft.workRate}
                onChange={set('workRate')}
              />
            </Field>
          ) : (
            <Field label={ui.employees.fieldWorkRate}>
              <ReadonlyValue value={draft.workRate || ui.common.notSet} />
            </Field>
          )}
          {canManage ? (
            <Field label={ui.employees.fieldHiredAt}>
              <DateTimePicker
                value={parseIsoDate(draft.hiredAt)}
                onChange={(date) => onChange({ hiredAt: date ? localDateStr(date) : '' })}
                ariaLabel={ui.employees.fieldHiredAt}
                placeholder={ui.common.notSet}
                withTime={false}
                format="full"
              />
            </Field>
          ) : (
            <Field label={ui.employees.fieldHiredAt}>
              <ReadonlyValue value={draft.hiredAt || ui.common.notSet} />
            </Field>
          )}
          <Field label={ui.employees.fieldGender}>
            <Select
              value={draft.gender ?? NONE}
              onValueChange={(value) =>
                onChange({ gender: value === NONE ? null : (value as Gender) })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4}>
                <SelectItem value={NONE}>{ui.employees.genderUnset}</SelectItem>
                <SelectItem value="male">{ui.employees.genderMale}</SelectItem>
                <SelectItem value="female">{ui.employees.genderFemale}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={ui.employees.fieldBirthDate}>
            <DateTimePicker
              value={parseIsoDate(draft.birthDate)}
              onChange={(date) => onChange({ birthDate: date ? localDateStr(date) : '' })}
              ariaLabel={ui.employees.fieldBirthDate}
              placeholder={ui.common.notSet}
              withTime={false}
              format="full"
            />
          </Field>
          <Field label={ui.employees.fieldWorkdayStart}>
            <TimePicker
              value={draft.workdayStart || null}
              onChange={(time) => onChange({ workdayStart: time ?? '' })}
              ariaLabel={ui.employees.fieldWorkdayStart}
              placeholder={ui.common.notSet}
            />
          </Field>
        </div>
      </Section>

      <Section title={ui.employees.sectionStructure}>
        {canManage ? (
          <div className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-2">
            <Field label={ui.employees.department}>
              <Select
                value={draft.departmentId ?? NONE}
                onValueChange={(value) => onChange({ departmentId: value === NONE ? null : value })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value={NONE}>{ui.employees.notSelected}</SelectItem>
                  {draft.departmentId &&
                  !departments.some((item) => item.id === draft.departmentId) ? (
                    <SelectItem value={draft.departmentId} disabled>
                      {ui.employees.archivedValue}
                    </SelectItem>
                  ) : null}
                  {departments.map((department) => (
                    // Плоский список (вердикт приёмки 18.11.2026): порядок
                    // дерева сохранён, уровни отступами не рисуются — длинное
                    // дерево читается как список без «лесенки».
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={ui.employees.position}>
              <Select
                value={draft.positionId ?? NONE}
                onValueChange={(value) => onChange({ positionId: value === NONE ? null : value })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value={NONE}>{ui.employees.notSelected}</SelectItem>
                  {draft.positionId && !positions.some((item) => item.id === draft.positionId) ? (
                    <SelectItem value={draft.positionId} disabled>
                      {ui.employees.archivedValue}
                    </SelectItem>
                  ) : null}
                  {positions.map((position) => (
                    <SelectItem key={position.id} value={position.id}>
                      {position.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-2">
            <Field label={ui.employees.department}>
              <ReadonlyValue
                tone="info"
                value={
                  departments.find((item) => item.id === draft.departmentId)?.name ??
                  ui.common.notSet
                }
              />
            </Field>
            <Field label={ui.employees.position}>
              <ReadonlyValue
                tone="info"
                value={
                  positions.find((item) => item.id === draft.positionId)?.name ?? ui.common.notSet
                }
              />
            </Field>
          </div>
        )}
        <Field
          label={ui.employees.fieldManager}
          hint={ui.employees.managerComputedHint}
          hintShort={ui.employees.managerComputedTag}
        >
          <ReadonlyValue value={manager?.displayName ?? ui.common.notSet} />
        </Field>
      </Section>
    </div>
  );
}
