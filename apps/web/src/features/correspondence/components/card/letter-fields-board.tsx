import {
  Building2,
  CalendarClock,
  CalendarDays,
  FolderKanban,
  Hash,
  Inbox,
  Lock,
  TriangleAlert,
  UserCheck,
  UserRound,
} from 'lucide-react';
import { memo } from 'react';
import type { LetterDetail, UpdateLetterBody } from '@nodus/contracts';
import { LETTER_LIMITS, isFinalState, ui } from '@nodus/contracts';
import { Switch } from '@nodus/ui/components/switch';
import { toast } from 'sonner';

import { projectsAvailable } from '../../../../shared/api/projects-available.js';
import { useProjectsList } from '../../../../shared/api/projects-list.js';
import { useUsersSearch } from '../../../../shared/api/users-list.js';
import { EntityFields, type EntityFieldDef } from '../../../../shared/ui/entity-fields.js';
import { ResponseDeadline } from '../../../../shared/views/letter-table-fields.js';
import { useUpdateLetter } from '../../api/letters-mutations.js';
import { useLetterResolvers } from '../../api/letters-queries.js';
import { formatIsoDate } from '../../lib/letter-format.js';
import { registrationReasonText } from '../../lib/registration-draft.js';
import {
  AddresseeValue,
  CounterpartyValue,
  ProjectValue,
  SignerValue,
} from './letter-entity-values.js';
import { DateFieldValue, ReceiptMethodValue, TextFieldValue } from './letter-field-editors.js';
import { infoFieldDefs } from './letter-fields-info.js';
import { mono, notSet } from './letter-value-bits.js';

const VISIBILITY_KEY = 'nodus-letter-fields-v1';

/**
 * Доска реквизитов письма (#55, U7; редизайн #56 — карточка-форма) на общем
 * каркасе `EntityFields` (грамматика полей карточки задачи, «+ Поле» —
 * видимость). Пары в две колонки. Правка — у `access.canEdit` (канцелярия;
 * после регистрации в работе — тоже), оптимистично: смена корреспондента
 * тем же PATCH сбрасывает подписанта. Незарегистрированное письмо — ФОРМА:
 * адресат редактируется по месту (после регистрации — только чтение, Р11),
 * обязательные поля (корреспондент, их №/дата, способ, адресат; тема — в
 * титуле слайдера) помечены звёздочкой, пустой пропуск подсвечен тоном —
 * «Зарегистрировать» без окна требует их заполнения. Тема живёт в хроме
 * слайдера (`LetterTitle`), здесь не дублируется.
 */
export const LetterFieldsBoard = memo(function LetterFieldsBoard({
  letter,
}: {
  letter: LetterDetail;
}) {
  const update = useUpdateLetter(letter.id);
  const { data: projects } = useProjectsList({
    enabled: letter.access.canEdit && (projectsAvailable('letters') || letter.project !== null),
  });
  // Префетч справочников выбора (вердикт владельца 28.10): попап поля
  // открывается с данными сразу, а не с пустой загрузкой — запросы грейятся
  // монтированием карточки, кэш общий со полями-селекторами.
  useUsersSearch('');
  useLetterResolvers();
  const editable = letter.access.canEdit;
  const unregistered = letter.registeredAt === null;
  const save = (body: UpdateLetterBody, patch: Partial<LetterDetail>) =>
    update.mutate({ body, patch });
  const rejectDate = (reason: 'in_future' | 'in_past') =>
    toast.error(registrationReasonText[reason]);
  const withProject = projectsAvailable('letters') || letter.project !== null;

  const defs: EntityFieldDef[] = [
    {
      key: 'counterparty',
      icon: <Building2 className="size-3.5" />,
      label: ui.letters.fields.counterparty,
      required: unregistered,
      render: () => (
        <CounterpartyValue
          letter={letter}
          editable={editable}
          empty={notSet}
          onCommit={(counterparty) =>
            save(
              { counterpartyId: counterparty.id, signerId: null },
              { counterparty, signer: null },
            )
          }
        />
      ),
    },
    {
      key: 'signer',
      icon: <UserRound className="size-3.5" />,
      label: ui.letters.fields.signer,
      render: () => (
        <SignerValue
          letter={letter}
          editable={editable}
          onCommit={(signer) => save({ signerId: signer?.id ?? null }, { signer })}
        />
      ),
    },
    {
      key: 'theirNumber',
      icon: <Hash className="size-3.5" />,
      label: ui.letters.fields.theirNumber,
      required: unregistered,
      render: () => (
        <TextFieldValue
          value={letter.theirNumber}
          label={ui.letters.fields.theirNumber}
          maxLength={LETTER_LIMITS.theirNumber}
          editable={editable}
          empty={notSet}
          onCommit={(theirNumber) => save({ theirNumber }, { theirNumber })}
        />
      ),
    },
    {
      key: 'theirDate',
      icon: <CalendarDays className="size-3.5" />,
      label: ui.letters.fields.theirDate,
      required: unregistered,
      render: () => (
        <DateFieldValue
          value={letter.theirDate}
          label={ui.letters.fields.theirDate}
          editable={editable}
          rule="not_future"
          display={letter.theirDate ? mono(formatIsoDate(letter.theirDate)) : <>{notSet}</>}
          onRejected={rejectDate}
          onCommit={(theirDate) => theirDate && save({ theirDate }, { theirDate })}
        />
      ),
    },
    {
      key: 'addressee',
      icon: <UserCheck className="size-3.5" />,
      label: ui.letters.fields.addressee,
      required: unregistered,
      render: () => (
        <AddresseeValue
          letter={letter}
          editable={editable && unregistered}
          empty={notSet}
          onCommit={(addressee) => save({ addresseeId: addressee?.id ?? null }, { addressee })}
        />
      ),
    },
    // «Конфиденциально» (#461, Р4, В3): флаг в карточке — канцелярия.
    // Включение закрывает письмо, чат, файлы и поручения до участников;
    // строка-подсказка объясняет последствие, пока флаг включён — В СТРОКЕ
    // рядом с переключателем (канон форм: текст под контролом ломает
    // горизонталь «метка — поле»).
    {
      key: 'confidential',
      icon: <Lock className="size-3.5" />,
      label: ui.letters.confidential.label,
      render: () => (
        <div className="flex min-h-8 min-w-0 items-center gap-2.5">
          <Switch
            checked={letter.confidential}
            disabled={!editable}
            aria-label={ui.letters.confidential.label}
            onCheckedChange={(confidential) => save({ confidential }, { confidential })}
          />
          {letter.confidential ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {ui.letters.confidential.hint}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'responseDeadline',
      icon: <CalendarClock className="size-3.5" />,
      label: ui.letters.fields.responseDeadline,
      render: () => (
        <DateFieldValue
          value={letter.responseDeadline}
          label={ui.letters.fields.responseDeadline}
          editable={editable}
          rule="not_past"
          clearLabel={ui.letters.form.noDeadline}
          display={
            letter.responseDeadline ? (
              <ResponseDeadline
                deadline={letter.responseDeadline}
                state={letter.stage.systemState}
              />
            ) : (
              notSet
            )
          }
          onRejected={rejectDate}
          onCommit={(responseDeadline) => save({ responseDeadline }, { responseDeadline })}
        />
      ),
    },
    {
      key: 'receiptMethod',
      icon: <Inbox className="size-3.5" />,
      label: ui.letters.fields.receiptMethod,
      required: unregistered,
      render: () => (
        <ReceiptMethodValue
          letter={letter}
          editable={editable}
          empty={notSet}
          onCommit={(receiptMethod) =>
            save({ receiptMethodId: receiptMethod.id }, { receiptMethod })
          }
        />
      ),
    },
    ...(withProject
      ? [
          {
            key: 'project',
            icon: <FolderKanban className="size-3.5" />,
            label: ui.letters.fields.project,
            render: () => (
              <ProjectValue
                letter={letter}
                editable={editable && projectsAvailable('letters')}
                onCommit={(projectId) => {
                  const picked = projects?.items.find((p) => p.id === projectId);
                  save(
                    { projectId },
                    {
                      project: picked
                        ? {
                            id: picked.id,
                            code: picked.code,
                            name: picked.name,
                            color: picked.color,
                          }
                        : null,
                    },
                  );
                }}
              />
            ),
          },
        ]
      : []),
    // Читательские строки (факт поступления, отправитель, тип; у
    // зарегистрированного — дата регистрации и регистратор) — реестр
    // `letter-fields-info`.
    ...infoFieldDefs(letter, unregistered),
  ];

  // Подсказка, почему поля не правятся: зарегистрированное в работе без
  // права — канцелярия (незарегистрированное видит только она — там правка).
  const hint =
    !editable && letter.registeredAt !== null && !isFinalState(letter.stage.systemState)
      ? { icon: <Lock className="size-3.5" />, text: ui.letters.card.readOnlyHint }
      : null;

  // Флаги приёма почты (#56): письмо разобрано/сохранено не полностью;
  // PDF-копия тела не создана («Основной документ письма» #56).
  const mailFlags: string[] = [];
  if (letter.mail?.parseIssue) mailFlags.push(ui.letters.card.mailParseIssue);
  if (letter.mail?.storageIncomplete) mailFlags.push(ui.letters.card.mailStorageIncomplete);
  if (letter.mail?.bodyPdfIssue) mailFlags.push(ui.letters.card.mailBodyPdfIssue);

  return (
    <>
      {mailFlags.length > 0 ? (
        <div className="mb-3 flex flex-col gap-1 text-xs text-warning">
          {mailFlags.map((flag) => (
            <p key={flag} className="flex items-center gap-1.5">
              <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {flag}
            </p>
          ))}
        </div>
      ) : null}
      <EntityFields defs={defs} storageKey={VISIBILITY_KEY} />
      {hint ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className="shrink-0 opacity-70">
            {hint.icon}
          </span>
          {hint.text}
        </p>
      ) : null}
    </>
  );
});
