import { useEffect, useState } from 'react';
import { createInvitationSchema, ErrorCode, errorMessages, ui } from '@nodus/contracts';
import type { InvitationCreated } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Field, FieldGroup, FieldLabel } from '@nodus/ui/components/field';
import { Input } from '@nodus/ui/components/input';

import { ApiError } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { useDepartmentsList } from '../../../shared/api/departments-list.js';
import { useCreateInvitation, usePositions } from '../api/directory-api.js';
import { ReferenceCombobox } from './reference-combobox.js';

type FieldKey = 'lastName' | 'firstName' | 'email' | 'positionId' | 'departmentId';
type FieldErrors = Partial<Record<FieldKey, string>>;

/** Звёздочка обязательного поля: скрыта от скринридеров и accessible name. */
function RequiredMark() {
  return <span aria-hidden> *</span>;
}

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
        field === 'departmentId'
      ) {
        errors[field] = errorMessages[ErrorCode.VALIDATION_FAILED];
      }
    }
    return Object.keys(errors).length > 0 ? errors : null;
  }
  return null;
}

function requiredMessage(key: FieldKey): string {
  switch (key) {
    case 'lastName':
      return ui.employees.inviteLastNameRequired;
    case 'firstName':
      return ui.employees.inviteFirstNameRequired;
    case 'email':
      return ui.employees.inviteEmailRequired;
    case 'positionId':
      return ui.employees.invitePositionRequired;
    case 'departmentId':
      return ui.employees.inviteDepartmentRequired;
  }
}

/**
 * Форма приглашения (#101): обязательные ФИО, рабочая почта, управленческие
 * должность и подразделение; руководитель производный (ADR-0053). Ошибки —
 * по полям (blur/отправка), дубль почты с сервера — inline. Вынесена из
 * диалога (I5): диалог держит только шаг «ссылка готова».
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
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});

  // Открытие из другого подразделения подставляет ЕГО отдел (#101): useState
  // помнил только первый монтированный — приглашение уходило не туда.
  useEffect(() => {
    setDepartmentId(initialDepartmentId);
  }, [initialDepartmentId]);

  const filled = {
    lastName: lastName.trim().length > 0,
    firstName: firstName.trim().length > 0,
    email: email.trim().length > 0,
    positionId: positionId !== null,
    departmentId: departmentId !== null,
  };
  const complete = Object.values(filled).every(Boolean);

  function fieldError(key: FieldKey): string | undefined {
    if (errors[key]) return errors[key];
    if (!touched[key] || filled[key]) return undefined;
    return requiredMessage(key);
  }

  function markTouched(key: FieldKey): void {
    setTouched((prev) => ({ ...prev, [key]: true }));
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    for (const key of Object.keys(filled) as FieldKey[]) {
      if (!filled[key]) next[key] = requiredMessage(key);
    }
    if (filled.email && !createInvitationSchema.shape.email.safeParse(email.trim()).success) {
      next.email = ui.employees.inviteEmailRequired;
    }
    return next;
  }

  async function submit(): Promise<void> {
    const validation = validate();
    setTouched({
      lastName: true,
      firstName: true,
      email: true,
      positionId: true,
      departmentId: true,
    });
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    setErrors({});
    try {
      const result = await create.mutateAsync({
        email: email.trim().toLowerCase(),
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        middleName: middleName.trim() || null,
        positionId: positionId!,
        departmentId: departmentId!,
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
          <Field data-invalid={fieldError('lastName') ? true : undefined}>
            <FieldLabel htmlFor="invite-last-name">
              {ui.employees.inviteLastName}
              <RequiredMark />
            </FieldLabel>
            <Input
              id="invite-last-name"
              autoFocus
              value={lastName}
              aria-invalid={fieldError('lastName') ? true : undefined}
              onChange={(e) => {
                setLastName(e.target.value);
                if (errors.lastName) setErrors((prev) => ({ ...prev, lastName: undefined }));
              }}
              onBlur={() => markTouched('lastName')}
            />
            {fieldError('lastName') ? (
              <p className="text-xs text-destructive">{fieldError('lastName')}</p>
            ) : null}
          </Field>
          <Field data-invalid={fieldError('firstName') ? true : undefined}>
            <FieldLabel htmlFor="invite-first-name">
              {ui.employees.inviteFirstName}
              <RequiredMark />
            </FieldLabel>
            <Input
              id="invite-first-name"
              value={firstName}
              aria-invalid={fieldError('firstName') ? true : undefined}
              onChange={(e) => {
                setFirstName(e.target.value);
                if (errors.firstName) setErrors((prev) => ({ ...prev, firstName: undefined }));
              }}
              onBlur={() => markTouched('firstName')}
            />
            {fieldError('firstName') ? (
              <p className="text-xs text-destructive">{fieldError('firstName')}</p>
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
        <Field data-invalid={fieldError('email') ? true : undefined}>
          <FieldLabel htmlFor="invite-email">
            {ui.employees.inviteEmail}
            <RequiredMark />
          </FieldLabel>
          <Input
            id="invite-email"
            type="email"
            placeholder={ui.employees.inviteEmailPlaceholder}
            value={email}
            aria-invalid={fieldError('email') ? true : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
            }}
            onBlur={() => markTouched('email')}
          />
          {fieldError('email') ? (
            <p className="text-xs text-destructive">{fieldError('email')}</p>
          ) : null}
        </Field>
        <Field data-invalid={fieldError('positionId') ? true : undefined}>
          <FieldLabel>
            {ui.employees.invitePosition}
            <RequiredMark />
          </FieldLabel>
          <ReferenceCombobox
            value={positionId}
            onChange={(id) => {
              setPositionId(id);
              if (errors.positionId) setErrors((prev) => ({ ...prev, positionId: undefined }));
              markTouched('positionId');
            }}
            options={(positions.data ?? []).map((position) => ({
              id: position.id,
              label: position.name,
            }))}
            ariaLabel={ui.employees.invitePosition}
            allowClear={false}
          />
          {fieldError('positionId') ? (
            <p className="text-xs text-destructive">{fieldError('positionId')}</p>
          ) : null}
        </Field>
        <Field data-invalid={fieldError('departmentId') ? true : undefined}>
          <FieldLabel>
            {ui.employees.inviteDepartment}
            <RequiredMark />
          </FieldLabel>
          <ReferenceCombobox
            value={departmentId}
            onChange={(id) => {
              setDepartmentId(id);
              if (errors.departmentId) {
                setErrors((prev) => ({ ...prev, departmentId: undefined }));
              }
              markTouched('departmentId');
            }}
            options={departments
              .filter((department) => department.isActive)
              .map((department) => ({ id: department.id, label: department.name }))}
            ariaLabel={ui.employees.inviteDepartment}
            allowClear={false}
            placement="bottom"
          />
          {fieldError('departmentId') ? (
            <p className="text-xs text-destructive">{fieldError('departmentId')}</p>
          ) : null}
        </Field>
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
