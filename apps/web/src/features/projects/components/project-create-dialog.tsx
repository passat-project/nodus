import { useState, type ReactNode } from 'react';
import type {
  CounterpartyRef,
  CustomFieldRef,
  CustomFieldValue,
  CustomFieldValues,
  ProjectType,
  ProjectVisibility,
} from '@nodus/contracts';
import {
  createProjectBodySchema,
  DEFAULT_PROJECT_TYPE_FORM,
  effectiveProjectTypeForm,
  ErrorCode,
  errorMessages,
  missingProjectFields,
  SYSTEM_FIELD_IDS,
  ui,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { Textarea } from '@nodus/ui/components/textarea';

import { ApiError } from '../../../shared/api-client.js';
import { usePortalSettings, useProjectTypes } from '../../../shared/api/projects-list.js';
import { definitionsForTarget } from '../../../shared/custom-fields/module-target.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import type { ProjectCreatePrefill } from '../../../shared/projects/project-create-store.js';
import { useCreateProject } from '../api/project-mutations.js';
import {
  counterpartyRefOf,
  mergeFieldRefs,
  PeopleMultiField,
  ManagerField,
  PortfolioField,
  ProjectAttributeRows,
  ProjectDeadlineField,
  VisibilityField,
} from './project-form-fields.js';

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * Окно «Новый проект» (Р14 #52): тип — ПЕРВЫМ после названия (вердикт
 * владельца 07.11.2026: как в задачах, набор полей зависит от типа),
 * атрибуты — слотами формы выбранного типа (Р10 #631: «Шифр» и «Заказчик»
 * стали обычными атрибутами, значения едут в customFields). Обязательные
 * слоты блокируют «Создать». Подсказок под полями нет — метки и контролы
 * стоят на одной линии. Окно заполняемое: клик мимо не закрывает, отмена —
 * кнопка или Esc.
 */
export function ProjectCreateDialog({
  prefill,
  onClose,
}: {
  prefill: ProjectCreatePrefill;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const types = useProjectTypes();
  const settings = usePortalSettings();
  const create = useCreateProject();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [typeId, setTypeId] = useState(prefill.typeId ?? '');
  const [managerId, setManagerId] = useState(me?.id ?? '');
  const [assistantIds, setAssistantIds] = useState<string[]>([]);
  const [observerIds, setObserverIds] = useState<string[]>([]);
  const [portfolioId, setPortfolioId] = useState<string | null>(prefill.portfolioId ?? null);
  const [visibility, setVisibility] = useState<ProjectVisibility | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [values, setValues] = useState<CustomFieldValues>({});
  const [refs, setRefs] = useState<CustomFieldRef[]>([]);
  const [client, setClient] = useState<CounterpartyRef | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaultVisibility = settings.data?.projects.defaultVisibility ?? 'open';
  const effectiveVisibility = visibility ?? defaultVisibility;
  const liveTypes = types.data ?? [];
  const selectedType: ProjectType | null = liveTypes.find((type) => type.id === typeId) ?? null;
  const definitions = useCustomFieldDefinitions('project');
  const boundDefinitions = definitionsForTarget(definitions.data, 'project', selectedType?.id);
  const form = selectedType
    ? effectiveProjectTypeForm(selectedType, boundDefinitions)
    : DEFAULT_PROJECT_TYPE_FORM;
  const missing = missingProjectFields(form, { customFields: values });
  const canSubmit =
    name.trim().length > 0 &&
    typeId.length > 0 &&
    !create.isPending &&
    liveTypes.length > 0 &&
    missing.length === 0;

  function onField(fieldId: string, value: CustomFieldValue | null, picked?: CustomFieldRef[]) {
    setValues((prev) => {
      const next = { ...prev };
      if (value === null) delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
    if (picked?.length) setRefs((prev) => mergeFieldRefs(prev, picked));
    if (fieldId === SYSTEM_FIELD_IDS.projectClient) setClient(counterpartyRefOf(picked?.[0]));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    // В тело идут только значения слотов выбранного типа: пережитки смены
    // типа сервер режет как «не привязан к типу» (422 not_in_type).
    const formIds = new Set(form.fields.map((slot) => slot.fieldId));
    const customFields = Object.fromEntries(
      Object.entries(values).filter(([fieldId]) => formIds.has(fieldId)),
    );
    const parsed = createProjectBodySchema.safeParse({
      name: name.trim(),
      description: description.trim() || undefined,
      typeId,
      portfolioId,
      managerId: managerId || undefined,
      assistantIds,
      observers: observerIds,
      visibility: effectiveVisibility,
      endDate,
      ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
    });
    if (!parsed.success) {
      setError(errorMessages[ErrorCode.VALIDATION_FAILED]);
      return;
    }
    create.mutate(
      { body: parsed.data, client },
      {
        onSuccess: onClose,
        onError: (failure) =>
          setError(
            failure instanceof ApiError
              ? (errorMessages[failure.code as ErrorCode] ?? ui.common.saveError)
              : ui.common.saveError,
          ),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl gap-0 p-0 sm:max-w-2xl"
        aria-describedby={undefined}
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="px-5 pt-4 text-base font-semibold">
          {ui.projects.createTitle}
        </DialogTitle>
        <form onSubmit={submit} className="flex max-h-[80vh] flex-col">
          <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={ui.projects.fieldName}
              aria-label={ui.projects.fieldName}
              className="h-9 text-body-lg"
            />

            <div className="grid grid-cols-[7.5rem_1fr] items-center gap-x-3 gap-y-3">
              {/* Тип — ПЕРВОЕ поле формы сразу после названия и обычной
                  строкой сетки (label слева, селект справа — как «Тип задачи»):
                  от типа зависит набор атрибутов (форма типа — Р10 #631). */}
              <FieldLabel>{ui.projects.fieldType}</FieldLabel>
              {types.isLoading ? (
                <Skeleton className="h-8 w-full" />
              ) : liveTypes.length === 0 ? (
                <span className="text-xs text-muted-foreground">{ui.projects.typesEmpty}</span>
              ) : (
                <Select value={typeId} onValueChange={setTypeId}>
                  <SelectTrigger className="h-8 w-full" aria-label={ui.projects.fieldType}>
                    <SelectValue placeholder={ui.projects.typePlaceholder} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="nokey">
                    {liveTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Атрибуты слотов формы выбранного типа (после типа — как
                  поля типа в задачах); до выбора типа не спрашиваются. */}
              <ProjectAttributeRows
                type={selectedType}
                values={values}
                refs={refs}
                onChange={onField}
              />

              <FieldLabel>{ui.projects.manager}</FieldLabel>
              <ManagerField
                value={managerId}
                label={ui.projects.manager}
                onChange={(userId) => {
                  setManagerId(userId);
                  setAssistantIds((prev) => prev.filter((id) => id !== userId));
                  setObserverIds((prev) => prev.filter((id) => id !== userId));
                }}
              />

              <FieldLabel>{ui.projects.assistants}</FieldLabel>
              <PeopleMultiField
                value={assistantIds}
                label={ui.projects.assistants}
                excludeIds={[managerId, ...observerIds]}
                onChange={setAssistantIds}
              />

              {/* Наблюдатели задаются сразу при создании: просмотр без прав
                  правки, участники придут из задач (вердикт 29.10 В2). */}
              <FieldLabel>{ui.projects.observers}</FieldLabel>
              <PeopleMultiField
                value={observerIds}
                label={ui.projects.observers}
                excludeIds={[managerId, ...assistantIds]}
                onChange={setObserverIds}
              />

              <FieldLabel>{ui.projects.filterPortfolio}</FieldLabel>
              <PortfolioField
                value={portfolioId}
                label={ui.projects.filterPortfolio}
                onChange={setPortfolioId}
              />

              <FieldLabel>{ui.projects.fieldVisibility}</FieldLabel>
              <VisibilityField
                value={effectiveVisibility}
                label={ui.projects.fieldVisibility}
                canMakeSecret
                onChange={setVisibility}
              />

              <FieldLabel>{ui.projects.deadline}</FieldLabel>
              <ProjectDeadlineField value={endDate} onChange={setEndDate} />
            </div>

            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={ui.projects.fieldDescription}
              aria-label={ui.projects.fieldDescription}
              rows={3}
              className="text-sm"
            />

            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
          {/* Кнопки окна — СПРАВА, как во всех окнах портала (вердикт
              владельца 07.11.2026): отмена — тихая, главное действие — primary. */}
          <div className="flex h-12 shrink-0 items-center justify-end gap-2 px-5">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              {ui.common.cancel}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {ui.projects.createSubmit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
