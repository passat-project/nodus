import { useMemo, useState } from 'react';
import type {
  ProcessCategory,
  PublishWorkflowResult,
  WorkflowDetail,
  WorkflowDraftDocument,
  WorkflowProblem,
} from '@nodus/contracts';
import { ErrorCode, errorMessages, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@nodus/ui/components/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { ApiError } from '../../../../shared/api-client.js';
import { pluralRu } from '../../lib/plural-ru.js';
import { useProcessTypes, type usePublishWorkflow } from '../../api/automation-api.js';
import { flushLayoutAutosave } from '../../model/use-layout-autosave.js';
import { PublishAffected } from './publish-affected.js';
import { PublishWarnings } from './publish-warnings.js';

/** Дефолт переноса: первый живой статус того же этапа, иначе начальный. */
function defaultTargetOf(
  baseline: WorkflowDraftDocument,
  doc: WorkflowDraftDocument,
  removedStageId: string,
): string {
  const removedStage = baseline.stages.find((s) => s.id === removedStageId);
  if (!removedStage) return '';
  return (
    doc.stages.find((s) => s.systemState === removedStage.systemState)?.id ??
    doc.stages.find((s) => s.isInitial)?.id ??
    doc.stages[0]?.id ??
    ''
  );
}

/** Сводка по спеке: «+2 статуса, −1 статус, 3 кнопки изменены». */
export function publishSummary(
  baseline: WorkflowDraftDocument,
  next: WorkflowDraftDocument,
): string {
  const addedStages = next.stages.filter((s) => !baseline.stages.some((b) => b.id === s.id)).length;
  const removedStages = baseline.stages.filter(
    (s) => !next.stages.some((n) => n.id === s.id),
  ).length;
  const addedTransitions = next.transitions.filter(
    (t) => !baseline.transitions.some((b) => b.id === t.id),
  ).length;
  const removedTransitions = baseline.transitions.filter(
    (t) => !next.transitions.some((n) => n.id === t.id),
  ).length;
  const changedStages = next.stages.filter((s) => {
    const before = baseline.stages.find((b) => b.id === s.id);
    return before && JSON.stringify(before) !== JSON.stringify(s);
  }).length;
  const changedTransitions = next.transitions.filter((t) => {
    const before = baseline.transitions.find((b) => b.id === t.id);
    return before && JSON.stringify(before) !== JSON.stringify(t);
  }).length;

  const parts: string[] = [];
  if (addedStages) parts.push(`+${addedStages} ${pluralRu(addedStages, ui.automation.statStages)}`);
  if (removedStages)
    parts.push(`−${removedStages} ${pluralRu(removedStages, ui.automation.statStages)}`);
  if (changedStages)
    parts.push(`${changedStages} ${pluralRu(changedStages, ui.automation.stagesChangedForms)}`);
  if (addedTransitions)
    parts.push(`+${addedTransitions} ${pluralRu(addedTransitions, ui.automation.statButtons)}`);
  if (removedTransitions)
    parts.push(`−${removedTransitions} ${pluralRu(removedTransitions, ui.automation.statButtons)}`);
  if (changedTransitions)
    parts.push(
      `${changedTransitions} ${pluralRu(changedTransitions, ui.automation.buttonsChangedForms)}`,
    );
  // Расстановка общая для всех — её правка тоже публикация.
  if (JSON.stringify(baseline.layout ?? null) !== JSON.stringify(next.layout ?? null)) {
    parts.push(ui.automation.publishLayoutChanged);
  }
  // Форма создания типа (#432) — раздел документа, публикуется версией.
  if (JSON.stringify(baseline.creation ?? null) !== JSON.stringify(next.creation ?? null)) {
    parts.push(ui.automation.publishCreationChanged);
  }
  return parts.length > 0 ? parts.join(', ') : ui.automation.publishNothingChanged;
}

/** Задачи в удаляемых статусах, о которых сервер сообщил отказом 422. */
function migrationGaps(error: unknown): Record<string, number> {
  if (!(error instanceof ApiError) || error.code !== ErrorCode.WORKFLOW_MIGRATION_REQUIRED) {
    return {};
  }
  const stages = (error.details?.stages ?? []) as { stageId: string; count: number }[];
  return Object.fromEntries(stages.map((s) => [s.stageId, s.count]));
}

/**
 * Диалог публикации — сводка изменений; для каждого удаляемого статуса с
 * задачами — обязательный выбор «куда перенести». Отказы сервера понятны:
 * конфликт версий (409) — «Загрузить свежую версию» (локальные правки
 * сбрасываются); задачи появились в удаляемых статусах (422) — выбор
 * переноса для них; проблемы схемы (422) — список; прочее — текст ошибки.
 */
export function PublishDialog({
  open,
  onClose,
  workflow,
  category: typeCategory,
  baseline,
  document: doc,
  baseVersion,
  problems = [],
  publish,
  onPublished,
  onConflictLoad,
}: {
  open: boolean;
  onClose: () => void;
  workflow: WorkflowDetail;
  /** Категория типа — фолбэк, если у маршрута ещё нет типов (#430). */
  category: ProcessCategory;
  baseline: WorkflowDraftDocument;
  document: WorkflowDraftDocument;
  baseVersion: number;
  /** Live-проверки редактора (#430): warnings не блокируют публикацию. */
  problems?: readonly WorkflowProblem[];
  publish: ReturnType<typeof usePublishWorkflow>;
  onPublished: (result: PublishWorkflowResult) => void;
  /** 409: загрузить свежую версию (локальные правки сбрасываются). */
  onConflictLoad: () => void;
}) {
  // Счётчики, присланные сервером в отказе, переживают повторную попытку.
  const [serverCounts, setServerCounts] = useState<Record<string, number>>({});
  const countOf = (stageId: string) =>
    serverCounts[stageId] ?? workflow.stageEntityCounts[stageId] ?? 0;
  const { data: types = [] } = useProcessTypes('include');
  const affectedTypes = types.filter(
    (t) => t.archivedAt === null && workflow.typeIds.includes(t.id),
  );
  const category = affectedTypes[0]?.category ?? typeCategory;
  const inFlightStageIds = new Set([...baseline.stages, ...doc.stages].map((s) => s.id));
  const inFlight = [...inFlightStageIds].reduce((sum, id) => {
    const stage = doc.stages.find((s) => s.id === id) ?? baseline.stages.find((s) => s.id === id);
    return stage?.systemState === 'closed' ? sum : sum + countOf(id);
  }, 0);
  const liveWarnings = problems.filter((p) => p.severity === 'warning');
  const removed = baseline.stages.filter((s) => !doc.stages.some((n) => n.id === s.id));
  const removedWithTasks = removed.filter((s) => countOf(s.id) > 0);
  const restates = baseline.stages
    .map((before) => ({
      before,
      after: doc.stages.find((n) => n.id === before.id),
      count: workflow.stageEntityCounts[before.id] ?? 0,
    }))
    .filter(
      (row) => row.after && row.after.systemState !== row.before.systemState && row.count > 0,
    );

  const [targets, setTargets] = useState<Record<string, string>>({});
  const migrations = useMemo(
    () =>
      removedWithTasks.map((s) => ({
        fromStageId: s.id,
        toStageId: targets[s.id] ?? defaultTargetOf(baseline, doc, s.id),
      })),
    [removedWithTasks, targets, baseline, doc],
  );

  const error = publish.error instanceof ApiError ? publish.error : null;
  const conflict = error?.code === ErrorCode.WORKFLOW_VERSION_CONFLICT;
  const serverProblems =
    error?.code === ErrorCode.WORKFLOW_INVALID
      ? ((error.details?.problems ?? []) as WorkflowProblem[])
      : [];
  const otherError =
    publish.isError &&
    !conflict &&
    error?.code !== ErrorCode.WORKFLOW_INVALID &&
    error?.code !== ErrorCode.WORKFLOW_MIGRATION_REQUIRED;

  // Сначала — несохранённая расстановка (места стоящих элементов сервер
  // берёт из сохранённой раскладки), затем публикация структуры.
  const [flushing, setFlushing] = useState(false);
  const submit = async () => {
    setFlushing(true);
    await flushLayoutAutosave(workflow.id);
    setFlushing(false);
    publish.mutate(
      { baseVersion, document: doc, migrations },
      {
        onSuccess: (result) => {
          onPublished(result);
          onClose();
        },
        onError: (failure) => {
          const gaps = migrationGaps(failure);
          if (Object.keys(gaps).length > 0) setServerCounts((prev) => ({ ...prev, ...gaps }));
        },
      },
    );
  };

  if (conflict) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{ui.automation.conflictTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{errorMessages.WORKFLOW_VERSION_CONFLICT}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {ui.automation.conflictCancel}
            </Button>
            <Button onClick={onConflictLoad}>{ui.automation.conflictLoad}</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{ui.automation.publishTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{publishSummary(baseline, doc)}</p>

        <PublishAffected
          typeNames={affectedTypes.map((t) => t.name)}
          inFlight={inFlight}
          category={category}
        />

        {liveWarnings.length > 0 ? (
          <PublishWarnings problems={liveWarnings} document={doc} />
        ) : null}

        {Object.keys(serverCounts).length > 0 ? (
          <p role="alert" className="text-sm text-warning">
            {ui.automation.publishMigrationsAppeared}
          </p>
        ) : null}

        {removedWithTasks.length > 0 ? (
          <div className="flex flex-col gap-2">
            {removedWithTasks.map((stage) => (
              <div key={stage.id} className="flex min-w-0 flex-col gap-1">
                <span className="text-sm">
                  {stage.name} — {countOf(stage.id)} {ui.automation.publishMigrateTo}:
                </span>
                <Select
                  value={targets[stage.id] ?? defaultTargetOf(baseline, doc, stage.id)}
                  onValueChange={(value) => setTargets((prev) => ({ ...prev, [stage.id]: value }))}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={`${stage.name} — ${ui.automation.publishMigrateTo}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="nokey">
                    {doc.stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {ui.automation.bands[s.systemState]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        ) : null}

        {restates.length > 0 ? (
          <div className="flex flex-col gap-1">
            {restates.map((row) => (
              <p key={row.before.id} className="text-xs text-muted-foreground">
                {row.count} · {row.before.name}: {ui.automation.bands[row.before.systemState]} →{' '}
                {ui.automation.bands[row.after!.systemState]} — {ui.automation.publishRestateNote}
              </p>
            ))}
          </div>
        ) : null}

        {serverProblems.length > 0 ? (
          <div role="alert" className="flex flex-col gap-1 text-sm text-danger">
            <span>{ui.automation.publishServerProblems}</span>
            <ul className="flex flex-col gap-0.5 pl-4">
              {serverProblems.map((problem, index) => (
                <li key={`${problem.code}-${index}`} className="list-disc">
                  {ui.automation.problems[problem.code]}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {otherError ? (
          <p role="alert" className="text-sm text-danger">
            {(error ? errorMessages[error.code as ErrorCode] : undefined) ?? ui.common.saveError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={publish.isPending || flushing} onClick={() => void submit()}>
            {ui.automation.publish}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
