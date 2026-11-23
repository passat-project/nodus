import { useState } from 'react';
import type { InvitationCreated } from '@nodus/contracts';
import { createInvitationSchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nodus/ui/components/dialog';
import { Field, FieldGroup, FieldLabel } from '@nodus/ui/components/field';
import { Input } from '@nodus/ui/components/input';
import { toast } from 'sonner';

import { toastApiError } from '../../../shared/api/error-toast.js';
import { useDepartmentsList } from '../../../shared/api/departments-list.js';
import { useCreateInvitation, usePositions } from '../api/directory-api.js';
import { ReferenceCombobox } from './reference-combobox.js';

/**
 * Приглашение сотрудника по ссылке (#101): создаёт пользователя со статусом
 * «Приглашён» и одноразовую ссылку; админ передаёт её вручную (письма пока
 * нет — #991). Обязательные поля: ФИО, управленческие должность и
 * подразделение, рабочая почта; руководитель производный (ADR-0053).
 */
export function InviteDialog({
  open,
  onOpenChange,
  initialDepartmentId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Предвыбранный отдел из панели подразделения (#881). */
  initialDepartmentId?: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InvitationCreated | null>(null);

  const link = created ? `${window.location.origin}${created.path}` : '';

  function reset(): void {
    setLastName('');
    setFirstName('');
    setMiddleName('');
    setEmail('');
    setPositionId(null);
    setDepartmentId(initialDepartmentId);
    setError(null);
    setCreated(null);
  }

  function close(): void {
    reset();
    onOpenChange(false);
  }

  async function submit(): Promise<void> {
    const parsed = createInvitationSchema.safeParse({
      email: email.trim(),
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      middleName: middleName.trim() || null,
      positionId,
      departmentId,
    });
    if (!parsed.success) {
      setError(ui.employees.inviteRequired);
      return;
    }
    setError(null);
    try {
      const result = await create.mutateAsync(parsed.data);
      setCreated(result);
    } catch (err) {
      toastApiError(err);
    }
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(ui.common.linkCopied);
    } catch {
      toast.error(ui.common.copyError);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent className="w-full sm:max-w-lg">
        <DialogTitle>
          {created ? ui.employees.inviteLinkTitle : ui.employees.inviteTitle}
        </DialogTitle>
        <DialogDescription>
          {created ? ui.employees.inviteLinkLead : ui.employees.inviteLead}
        </DialogDescription>

        {created ? (
          <div className="flex flex-col gap-4 pt-2">
            <Field>
              <FieldLabel htmlFor="invite-link">{ui.employees.inviteCopyLink}</FieldLabel>
              <Input id="invite-link" readOnly value={link} onFocus={(e) => e.target.select()} />
            </Field>
            <p className="text-sm text-muted-foreground">
              {ui.employees.inviteLinkExpires}{' '}
              <span className="font-medium text-foreground">
                {new Date(created.expiresAt).toLocaleDateString('ru-RU')}
              </span>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => void copyLink()}>
                {ui.employees.inviteCopyLink}
              </Button>
              <Button onClick={close}>{ui.common.close}</Button>
            </div>
          </div>
        ) : (
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
                <Field>
                  <FieldLabel htmlFor="invite-last-name">{ui.employees.inviteLastName}</FieldLabel>
                  <Input
                    id="invite-last-name"
                    autoFocus
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="invite-first-name">
                    {ui.employees.inviteFirstName}
                  </FieldLabel>
                  <Input
                    id="invite-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="invite-middle-name">
                  {ui.employees.inviteMiddleName}
                </FieldLabel>
                <Input
                  id="invite-middle-name"
                  value={middleName}
                  onChange={(e) => setMiddleName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-email">{ui.employees.inviteEmail}</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder={ui.employees.inviteEmailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>{ui.employees.invitePosition}</FieldLabel>
                <ReferenceCombobox
                  value={positionId}
                  onChange={setPositionId}
                  options={(positions.data ?? []).map((position) => ({
                    id: position.id,
                    label: position.name,
                  }))}
                  ariaLabel={ui.employees.invitePosition}
                  allowClear={false}
                />
              </Field>
              <Field>
                <FieldLabel>{ui.employees.inviteDepartment}</FieldLabel>
                <ReferenceCombobox
                  value={departmentId}
                  onChange={setDepartmentId}
                  options={departments
                    .filter((department) => department.isActive)
                    .map((department) => ({
                      id: department.id,
                      label: `${'— '.repeat(department.depth)}${department.name}`,
                    }))}
                  ariaLabel={ui.employees.inviteDepartment}
                  allowClear={false}
                  placement="bottom"
                />
              </Field>
            </FieldGroup>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                {ui.common.cancel}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {ui.employees.inviteSubmit}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
