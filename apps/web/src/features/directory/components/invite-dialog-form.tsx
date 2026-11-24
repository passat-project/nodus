import { useEffect, useState } from 'react';
import { ErrorCode, errorMessages, ui } from '@nodus/contracts';
import type { InvitationCreated } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Field, FieldGroup, FieldLabel } from '@nodus/ui/components/field';
import { Input } from '@nodus/ui/components/input';

import { ApiError } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { useDepartmentsList } from '../../../shared/api/departments-list.js';
import { DateTimePicker } from '../../../shared/ui/date-time-picker.js';
import { localDateStr, parseIsoDate } from '../../../shared/ui/date-time-grid.js';
import { useCreateInvitation, usePositions } from '../api/directory-api.js';
import { ReferenceCombobox } from './reference-combobox.js';

type FieldKey =
  'lastName' | 'firstName' | 'email' | 'positionId' | 'departmentId' | 'workRate' | 'hiredAt';
type FieldErrors = Partial<Record<FieldKey, string>>;

/** Ошибка сервера → поле формы (#101): дубль почты — под почтой, а не тостом. */
function fieldErrorFromApi(error: ApiError): FieldErrors | null {
  if (error.code === ErrorCode.DIRECTORY_EMAIL_TAKEN) {
    return { email: errorMessages[ErrorCode.DIRECTORY_EMAIL_TAKEN] };
  }
  if (error.code === ErrorCode.VALIDATION_FAILED) {
    const issues = Array.isArray(error.details?.issues) ? error.details.issues : [];
    const errors: FieldErrors = {};
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object') continue;
      const path = (issue as { path?: unknown }).path;
      const field = typeof path === 'string' ? path.split('.')[0] : null;
      if (
        field === 'lastName' ||
        field === 'firstName' ||
        field === 'email' ||
        field === 'positionId' ||
        field === 'departmentId' ||
        field === 'workRate' ||
        field === 'hiredAt'
      ) {
        errors[field] = errorMessages[ErrorCode.VALIDATION_FAILED];
      }
    }
    return Object.keys(errors).length > 0 ? errors : null;
  }
  return null;
}

/** Пустая ставка → null («не задано» на сервере); иначе число. */
function rateOf(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Форма приглашения (#101): ФИО, рабочая почта, управленческие должность и
 * подразделение — пока заполнены не все, «Далее» неактивна; звёздочек и
 * клиентских «Укажите фамилию» нет (вердикт владельца 23.11.2026). Ставка и
 * дата приёма — необязательные HR-поля: сотрудник их сам не правит, поэтому
 * администратор задаёт их уже при приглашении. Руководитель производный
 * (ADR-0053); ошибки сервера — по полям, без тоста. Вынесена из диалога (I5):
 * диалог держит только шаг «ссылка готова».
 */
export function InviteDialogForm({
  initialDepartmentId,
  onCreated,
  onClose,
}: {
  initialDepartmentId: string | null;
  onCreated: (created: InvitationCreated) => void;
  onClose: () => void;
}) {
  const departments = useDepartmentsList();
  const positions = usePositions('management');
  const create = useCreateInvitation();
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [email, setEmail] = useState('');
  const [positionId, setPositionId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(initialDepartmentId);
  const [workRate, setWorkRate] = useState('');
  const [hiredAt, setHiredAt] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  // Открытие из другого подразделения подставляет ЕГО отдел (#101): useState
  // помнил только первый монтированный — приглашение уходило не туда.
  useEffect(() => {
    setDepartmentId(initialDepartmentId);
  }, [initialDepartmentId]);

  const complete =
    lastName.trim().length > 0 &&
    firstName.trim().length > 0 &&
    email.trim().length > 0 &&
    positionId !== null &&
    departmentId !== null;

  function clearError(key: FieldKey): void {
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  async function submit(): Promise<void> {
    setErrors({});
    try {
      const result = await create.mutateAsync({
        email: email.trim().toLowerCase(),
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        middleName: middleName.trim() || null,
        positionId: positionId!,
        departmentId: departmentId!,
        workRate: rateOf(workRate),
        hiredAt: hiredAt.trim() || null,
      });
      onCreated(result);
    } catch (err) {
      const mapped = err instanceof ApiError ? fieldErrorFromApi(err) : null;
      if (mapped) {
        setErrors(mapped);
        return;
      }
      toastApiError(err);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FieldGroup>
        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={errors.lastName ? true : undefined}>
            <FieldLabel htmlFor="invite-last-name">{ui.employees.inviteLastName}</FieldLabel>
            <Input
              id="invite-last-name"
              autoFocus
              value={lastName}
              aria-invalid={errors.lastName ? true : undefined}
              onChange={(e) => {
                setLastName(e.target.value);
                clearError('lastName');
              }}
            />
            {errors.lastName ? <p className="text-xs text-destructive">{errors.lastName}</p> : null}
          </Field>
          <Field data-invalid={errors.firstName ? true : undefined}>
            <FieldLabel htmlFor="invite-first-name">{ui.employees.inviteFirstName}</FieldLabel>
            <Input
              id="invite-first-name"
              value={firstName}
              aria-invalid={errors.firstName ? true : undefined}
              onChange={(e) => {
                setFirstName(e.target.value);
                clearError('firstName');
              }}
            />
            {errors.firstName ? (
              <p className="text-xs text-destructive">{errors.firstName}</p>
            ) : null}
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="invite-middle-name">{ui.employees.inviteMiddleName}</FieldLabel>
          <Input
            id="invite-middle-name"
            value={middleName}
            onChange={(e) => setMiddleName(e.target.value)}
          />
        </Field>
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="invite-email">{ui.employees.inviteEmail}</FieldLabel>
          <Input
            id="invite-email"
            type="email"
            placeholder={ui.employees.inviteEmailPlaceholder}
            value={email}
            aria-invalid={errors.email ? true : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError('email');
            }}
          />
          {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
        </Field>
        <Field data-invalid={errors.positionId ? true : undefined}>
          <FieldLabel>{ui.employees.invitePosition}</FieldLabel>
          <ReferenceCombobox
            value={positionId}
            onChange={(id) => {
              setPositionId(id);
              clearError('positionId');
            }}
            options={(positions.data ?? []).map((position) => ({
              id: position.id,
              label: position.name,
            }))}
            ariaLabel={ui.employees.invitePosition}
            allowClear={false}
          />
          {errors.positionId ? (
            <p className="text-xs text-destructive">{errors.positionId}</p>
          ) : null}
        </Field>
        <Field data-invalid={errors.departmentId ? true : undefined}>
          <FieldLabel>{ui.employees.inviteDepartment}</FieldLabel>
          <ReferenceCombobox
            value={departmentId}
            onChange={(id) => {
              setDepartmentId(id);
              clearError('departmentId');
            }}
            options={departments
              .filter((department) => department.isActive)
              .map((department) => ({ id: department.id, label: department.name }))}
            ariaLabel={ui.employees.inviteDepartment}
            allowClear={false}
          />
          {errors.departmentId ? (
            <p className="text-xs text-destructive">{errors.departmentId}</p>
          ) : null}
        </Field>
        {/* HR-поля необязательны и правятся только администратором (#101). */}
        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={errors.workRate ? true : undefined}>
            <FieldLabel htmlFor="invite-work-rate">{ui.employees.fieldWorkRate}</FieldLabel>
            <Input
              id="invite-work-rate"
              type="number"
              min={0}
              max={2}
              step={0.25}
              value={workRate}
              aria-invalid={errors.workRate ? true : undefined}
              onChange={(e) => {
                setWorkRate(e.target.value);
                clearError('workRate');
              }}
            />
            {errors.workRate ? <p className="text-xs text-destructive">{errors.workRate}</p> : null}
          </Field>
          <Field data-invalid={errors.hiredAt ? true : undefined}>
            <FieldLabel>{ui.employees.fieldHiredAt}</FieldLabel>
            <DateTimePicker
              value={parseIsoDate(hiredAt)}
              onChange={(date) => {
                setHiredAt(date ? localDateStr(date) : '');
                clearError('hiredAt');
              }}
              ariaLabel={ui.employees.fieldHiredAt}
              placeholder={ui.common.notSet}
              withTime={false}
              format="full"
            />
            {errors.hiredAt ? <p className="text-xs text-destructive">{errors.hiredAt}</p> : null}
          </Field>
        </div>
      </FieldGroup>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {ui.common.cancel}
        </Button>
        <Button type="submit" disabled={!complete || create.isPending}>
          {ui.employees.inviteSubmit}
        </Button>
      </div>
    </form>
  );
}
