import { useState } from 'react';
import type {
  CounterpartyRef,
  CustomFieldRef,
  CustomFieldValue,
  CustomFieldValues,
  ProjectDetail,
  ProjectType,
  ProjectVisibility,
} from '@nodus/contracts';
import {
  errorMessages,
  ErrorCode,
  effectiveProjectTypeForm,
  missingProjectFields,
  SYSTEM_FIELD_IDS,
  ui,
  updateProjectBodySchema,
  formSlots,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { Textarea } from '@nodus/ui/components/textarea';

import { ApiError } from '../../../shared/api-client.js';
import { useProjectTypes } from '../../../shared/api/projects-list.js';
import { definitionsForTarget } from '../../../shared/custom-fields/module-target.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { useUpdateProject } from '../api/project-mutations.js';
import {
  counterpartyRefOf,
  mergeFieldRefs,
  PeopleMultiField,
  PortfolioField,
  ProjectDeadlineField,
  VisibilityField,
} from './project-form-fields.js';
import { PROJECT_SYSTEM_LABELS, ProjectFormGrid } from './project-form-grid.js';

/**
 * «Поля проекта»: правка системных полей руководством (руководитель,
 * помощники, project.manage). Атрибуты — слотами формы типа проекта
 * (Р10 #631: шифр и заказчик среди них, значения едут в customFields),
 * обязательные слоты блокируют «Сохранить». Передача руководства и статусы
 * — отдельные действия карточки; смена видимости на секретный доступна
 * только руководителю (сервер — истина, I8).
 */
export function ProjectEditDialog({
  project,
  onClose,
}: {
  project: ProjectDetail;
  onClose: () => void;
}) {
  const update = useUpdateProject(project.id);
  // Форма типа проекта: ссылка карточки — только id, слоты берём из
  // справочника (вместе с архивными — тип могли убрать после создания).
  const types = useProjectTypes(true);
  const type: ProjectType | null =
    types.data?.find((entry) => entry.id === project.type?.id) ?? null;
  const definitions = useCustomFieldDefinitions('project');
  const boundDefinitions = definitionsForTarget(definitions.data, 'project', project.type?.id);
  const form = type
    ? effectiveProjectTypeForm(type, boundDefinitions)
    : effectiveProjectTypeForm({}, boundDefinitions);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [portfolioId, setPortfolioId] = useState(project.portfolio?.id ?? null);
  const [values, setValues] = useState<CustomFieldValues>({ ...project.customFields });
  const [refs, setRefs] = useState<CustomFieldRef[]>([...project.customFieldRefs]);
  const [client, setClient] = useState<CounterpartyRef | null>(project.client);
  const [assistantIds, setAssistantIds] = useState<string[]>(
    project.assistants.map((assistant) => assistant.id),
  );
  const [visibility, setVisibility] = useState<ProjectVisibility>(project.visibility);
  const [endDate, setEndDate] = useState<string | null>(project.endDate);
  const [error, setError] = useState<string | null>(null);
  // Попытка отправки: обязательные слоты показывают ошибку у поля (§4c).
  const [attempted, setAttempted] = useState(false);

  const canMakeSecret = project.access.canTransfer || project.visibility === 'secret';
  const missing = missingProjectFields(form, { customFields: values });
  const canSubmit = name.trim().length > 0 && !update.isPending;

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
    setAttempted(true);
    if (missing.length > 0) return;
    setError(null);
    // Патч значений — только изменившиеся ключи (null очищает): нетронутое
    // не едет, скрытые слоты формы типа не трогаются.
    const customFields: Record<string, CustomFieldValue | null> = {};
    for (const fieldId of new Set([...Object.keys(values), ...Object.keys(project.customFields)])) {
      const next = values[fieldId];
      if (next !== project.customFields[fieldId]) customFields[fieldId] = next ?? null;
    }
    const parsed = updateProjectBodySchema.safeParse({
      name: name.trim(),
      description: description.trim() || null,
      portfolioId,
      assistantIds,
      visibility,
      endDate,
      ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
    });
    if (!parsed.success) {
      setError(errorMessages[ErrorCode.VALIDATION_FAILED]);
      return;
    }
    // Заказчик виден строке журнала: ссылку обновляем, только если поле
    // вообще есть в форме типа (нет — не трогаем витрину).
    const clientShown = formSlots(form).some(
      (slot) => slot.fieldId === SYSTEM_FIELD_IDS.projectClient && slot.state !== 'hidden',
    );
    update.mutate(
      { body: parsed.data, client: clientShown ? client : undefined },
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
          {ui.projects.editTitle}
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

            {/* Окно проекта — на общей сетке (#496): атрибуты типа, системные
                строки и оформление в порядке редактора окна. Руководитель
                меняется отдельным действием карточки — здесь не показывается. */}
            <ProjectFormGrid
              type={type}
              definitions={boundDefinitions}
              values={values}
              refs={refs}
              errors={attempted ? new Set(missing) : undefined}
              onChange={onField}
              systemLabel={(key) => PROJECT_SYSTEM_LABELS[key]}
              renderSystem={(key) => {
                switch (key) {
                  case 'assistants':
                    return (
                      <PeopleMultiField
                        value={assistantIds}
                        label={ui.projects.assistants}
                        excludeIds={project.manager ? [project.manager.id] : []}
                        onChange={setAssistantIds}
                      />
                    );
                  case 'observers':
                    return null;
                  case 'portfolio':
                    return (
                      <PortfolioField
                        value={portfolioId}
                        label={ui.projects.filterPortfolio}
                        onChange={setPortfolioId}
                      />
                    );
                  case 'visibility':
                    return (
                      <VisibilityField
                        value={visibility}
                        label={ui.projects.fieldVisibility}
                        canMakeSecret={canMakeSecret}
                        onChange={setVisibility}
                      />
                    );
                  case 'endDate':
                    return <ProjectDeadlineField value={endDate} onChange={setEndDate} />;
                  case 'description':
                    return (
                      <Textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder={ui.projects.fieldDescription}
                        aria-label={ui.projects.fieldDescription}
                        rows={3}
                        className="text-sm"
                      />
                    );
                  default:
                    return null;
                }
              }}
            />

            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex h-12 shrink-0 items-center justify-end gap-2 px-5">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              {ui.common.cancel}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {ui.common.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
