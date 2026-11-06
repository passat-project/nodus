import { useId, useRef, type ReactNode } from 'react';
import type { LetterDetail, LetterRegistrationField } from '@nodus/contracts';
import { bindingsOf, ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Switch } from '@nodus/ui/components/switch';
import { Textarea } from '@nodus/ui/components/textarea';
import { cn } from '@nodus/ui/lib/utils';

import { projectsAvailable } from '../../../../shared/api/projects-available.js';
import { CounterpartyCombobox } from '../../../../shared/counterparties/counterparty-combobox.js';
import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { ProjectPicker } from '../../../../shared/ui/project-picker.js';
import { useReceiptMethods } from '../../api/letters-queries.js';
import {
  nextEmptyField,
  REQUIRED_FIELDS,
  registrationFieldLabel,
  type RegistrationDraft,
} from '../../lib/registration-draft.js';
import { focusRegistrationField } from '../../lib/registration-focus.js';
import { useSuggestedCounterparty } from '../../lib/registration-suggestion.js';
import { AddresseeField } from './addressee-field.js';
import { AttachedRefsSection } from './attached-refs-section.js';
import { RegistrationAttributes } from './registration-attributes.js';
import { DateInput } from './date-input.js';
import { ReplySuggestion } from './reply-suggestion.js';
import { SignerField } from './signer-field.js';

/**
 * Форма регистрации (#55, U5) — ОДНА в конвейере «Новые» и в окне
 * «Зарегистрировать» карточки: корреспондент с созданием на лету, подписант
 * из его контактов, их № и дата с клавиатуры, тема (у почты — из письма),
 * способ поступления, срок ответа, адресат («Принимают решения» сверху),
 * проект (если модуль доступен, Р15), атрибуты типа. Enter ведёт к
 * следующему ПУСТОМУ обязательному полю — сценарий «≤ 30 секунд»:
 * «Галур» Enter → их № Enter → дата Enter → «Шай» Enter → Ctrl+Enter.
 * Значение держит хост (`value`/`onChange`), ошибки — `invalidKeys`.
 */
export function RegistrationFields({
  letter,
  value,
  onChange,
  invalidKeys = {},
  autoFocus = false,
}: {
  letter: LetterDetail;
  value: RegistrationDraft;
  onChange: (next: RegistrationDraft) => void;
  invalidKeys?: Partial<Record<LetterRegistrationField, string>>;
  autoFocus?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const { data: methods = [] } = useReceiptMethods();
  const { data: definitions } = useCustomFieldDefinitions('letter');
  // Атрибуты типа письма — привязка «Где используется» (#631, Р3).
  const attributes = (definitions ?? []).filter((definition) =>
    bindingsOf(definition).processTypeIds.includes(letter.typeId),
  );

  // Подстановка контрагента/подписанта по адресу отправителя (Р6, В2).
  const { fromSuggestion } = useSuggestedCounterparty(letter, value, onChange);
  const fieldId = (field: LetterRegistrationField) => `${prefix}-${field}`;
  const errorId = (field: LetterRegistrationField) =>
    invalidKeys[field] ? `${prefix}-${field}-error` : undefined;

  function set(patch: Partial<RegistrationDraft>, advanceFrom?: LetterRegistrationField) {
    const next = { ...value, ...patch };
    onChange(next);
    if (advanceFrom) {
      const target = nextEmptyField(next, advanceFrom);
      requestAnimationFrame(() => focusRegistrationField(rootRef.current, target));
    }
  }

  // Обязательность — тонкой звёздочкой в тоне действия, прижатой к слову
  // (канон EntityFields; вердикт владельца 28.10 — вместо текстовых списков).
  const row = (field: LetterRegistrationField, control: ReactNode, className?: string) => (
    <div data-reg-field={field} className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={fieldId(field)} className="text-xs font-medium text-muted-foreground">
        {registrationFieldLabel[field]}
        {REQUIRED_FIELDS.includes(field) ? (
          <span aria-hidden className="ml-0.5 text-primary">
            *
          </span>
        ) : null}
      </label>
      {control}
      {invalidKeys[field] ? (
        <p id={errorId(field)} className="text-xs text-danger">
          {invalidKeys[field]}
        </p>
      ) : null}
    </div>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <ReplySuggestion
        letter={letter}
        value={value}
        invalid={invalidKeys.replyToLetterId}
        onToggle={(linkReply) => set({ linkReply })}
      />
      {row(
        'counterpartyId',
        <CounterpartyCombobox
          id={fieldId('counterpartyId')}
          value={value.counterparty}
          onChange={(ref) =>
            set(
              {
                counterparty: ref,
                signer: ref && ref.id === value.counterparty?.id ? value.signer : null,
              },
              ref ? 'counterpartyId' : undefined,
            )
          }
          ariaLabel={ui.letters.fields.counterparty}
          placeholder={ui.letters.form.counterpartyPlaceholder}
          invalid={Boolean(invalidKeys.counterpartyId)}
          describedBy={errorId('counterpartyId')}
          // Окно-контроль пропусков: фокус — только на ещё пустое поле, и он
          // молчалив — список не распахивается (приёмка 28.10: заполненное не
          // активируем, пустое не раскрываем; Enter-навигация живёт).
          autoFocus={autoFocus && !value.counterparty}
          openOnFocus={false}
        />,
      )}
      {fromSuggestion ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          {ui.letters.form.suggestedCounterparty}
        </p>
      ) : null}
      {row(
        'signerId',
        <SignerField
          id={fieldId('signerId')}
          counterpartyId={value.counterparty?.id ?? null}
          value={value.signer}
          onChange={(signer) => set({ signer })}
          invalid={Boolean(invalidKeys.signerId)}
          describedBy={errorId('signerId')}
        />,
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-3">
        {row(
          'theirNumber',
          <Input
            id={fieldId('theirNumber')}
            value={value.theirNumber}
            maxLength={64}
            autoComplete="off"
            placeholder={ui.letters.form.theirNumberPlaceholder}
            aria-invalid={Boolean(invalidKeys.theirNumber) || undefined}
            aria-describedby={errorId('theirNumber')}
            onChange={(e) => set({ theirNumber: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                set({}, 'theirNumber');
              }
            }}
            className="h-8 font-mono text-sm"
          />,
        )}
        {row(
          'theirDate',
          <DateInput
            id={fieldId('theirDate')}
            value={value.theirDate}
            onChange={(theirDate) => set({ theirDate })}
            onEnter={() => set({}, 'theirDate')}
            ariaLabel={ui.letters.fields.theirDate}
            invalid={Boolean(invalidKeys.theirDate)}
            describedBy={errorId('theirDate')}
          />,
        )}
      </div>
      {row(
        'subject',
        <Textarea
          id={fieldId('subject')}
          value={value.subject}
          rows={2}
          maxLength={500}
          placeholder={ui.letters.form.subjectPlaceholder}
          aria-invalid={Boolean(invalidKeys.subject) || undefined}
          aria-describedby={errorId('subject')}
          onChange={(e) => set({ subject: e.target.value.replace(/\n/g, ' ') })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              set({}, 'subject');
            }
          }}
          className="min-h-14 resize-none text-sm wrap-anywhere field-sizing-content"
        />,
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-3">
        {row(
          'receiptMethodId',
          <Select
            value={value.receiptMethodId ?? undefined}
            onValueChange={(receiptMethodId) => set({ receiptMethodId }, 'receiptMethodId')}
          >
            <SelectTrigger
              id={fieldId('receiptMethodId')}
              aria-invalid={Boolean(invalidKeys.receiptMethodId) || undefined}
              aria-describedby={errorId('receiptMethodId')}
              className="h-8 w-full text-sm"
            >
              <SelectValue placeholder={ui.letters.form.receiptMethodPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {methods.map((method) => (
                <SelectItem key={method.id} value={method.id}>
                  {method.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
        )}
        {row(
          'responseDeadline',
          <DateInput
            id={fieldId('responseDeadline')}
            value={value.responseDeadline}
            onChange={(responseDeadline) => set({ responseDeadline })}
            ariaLabel={ui.letters.fields.responseDeadline}
            placeholder={ui.letters.form.noDeadline}
            invalid={Boolean(invalidKeys.responseDeadline)}
            describedBy={errorId('responseDeadline')}
          />,
        )}
      </div>
      {row(
        'confidential',
        <div className="flex min-h-8 items-center gap-2.5">
          <Switch
            id={fieldId('confidential')}
            checked={value.confidential}
            aria-describedby={errorId('confidential')}
            onCheckedChange={(confidential) => set({ confidential })}
          />
          {value.confidential ? (
            <span className="text-xs text-muted-foreground">{ui.letters.confidential.hint}</span>
          ) : null}
        </div>,
      )}
      <AttachedRefsSection
        value={value.attachedRefs}
        onChange={(attachedRefs) => set({ attachedRefs })}
        invalid={invalidKeys.attachedRefs}
        errorId={errorId('attachedRefs')}
      />
      {row(
        'addresseeId',
        <AddresseeField
          id={fieldId('addresseeId')}
          value={value.addressee}
          onChange={(addressee) => set({ addressee }, addressee ? 'addresseeId' : undefined)}
          invalid={Boolean(invalidKeys.addresseeId)}
          describedBy={errorId('addresseeId')}
          openOnFocus={false}
        />,
      )}
      {projectsAvailable('letters')
        ? row(
            'projectId',
            <ProjectPicker
              value={value.projectId ?? undefined}
              onChange={(projectId) => set({ projectId: projectId ?? null })}
              ariaLabel={ui.letters.fields.project}
            />,
          )
        : null}
      {attributes.length > 0 ? (
        <RegistrationAttributes
          letter={letter}
          definitions={attributes}
          values={value.customFields}
          onChange={(customFields) => set({ customFields })}
          invalid={invalidKeys.customFields}
        />
      ) : null}
    </div>
  );
}
