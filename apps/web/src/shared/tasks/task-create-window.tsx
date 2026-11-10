import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProcessType } from '@nodus/contracts';
import { typeConfigOf, typeCreationFormOf, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { X } from 'lucide-react';

import { defaultTaskType, useCreatableProcessTypes } from '../api/process-types-api.js';
import { useCreateTask } from '../api/task-create.js';
import { useCanManageWorkflows } from '../api/use-can-manage-workflows.js';
import { useCustomFieldDefinitions } from '../custom-fields/queries.js';
import { ProcessTypeField } from './process-type-field.js';
import { TaskChecklistSheet } from './task-checklist-sheet.js';
import { TaskCreateChips } from './task-create-chips.js';
import {
  applyFormulaPrefill,
  emptyDraft,
  missingFor,
  missingTextOf,
  withChecklist,
  withNode,
  withTitle,
  withType,
  withValue,
  type TaskCreateDraft,
  type TaskCreatePrefill,
} from './task-create-draft.js';
import { type CreateFailure } from './task-create-errors.js';
import { TaskCreateFormBody } from './task-create-form-body.js';
import { FormSkeleton } from './task-create-skeleton.js';
import { TaskCreateFailure } from './task-create-secret-members.js';
import { useTaskCreateSecretFix } from './task-create-secret-fix.js';
import { TaskCreateStructure, useTaskCreateStructure } from './task-create-structure.js';
import { taskCreateSubmit } from './task-create-submit.js';
import { useCreationFormulaPrefill } from './use-creation-formula-prefill.js';
import {
  EMPTY_FORM,
  TITLE_KEY,
  wideWindow,
  withTitleSlot,
  type TaskCreatePreview,
} from './task-create-window-model.js';

export type { TaskCreatePreview };

/**
 * Единое окно создания задачи (#432, В1/Р9): верх зафиксирован — строка
 * названия с крестиком и тип, низ — форма выбранного типа, перестраивается
 * на лету. Значения живут в черновике по ключу слота: смена типа не стирает
 * совместимое. «Создать» неактивна, пока пусто название или обязательное
 * поле; живая строка «Не хватает: …» — `aria-describedby`. Создание
 * пессимистичное: номер, стадию и скрытые значения назначает сервер.
 *
 * Правый край ровный (вердикт владельца 26.10.2026): крестик — кнопка-иконка
 * по центру строки названия, ⚙ типа — такая же кнопка в той же колонке, поле
 * названия и поле типа кончаются на одной вертикали. Клик мимо окно не
 * закрывает (канон заполняемых окон); Esc сначала закрывает вложенный лист
 * чек-листа и ввод плана — Radix ловит Esc на document в capture раньше их
 * обработчиков, поэтому гасим его здесь (`onEscapeKeyDown`, gotchas).
 *
 * `preview` — «Посмотреть окно» редактора: настоящее окно по центру экрана с
 * черновой формой, поля живые (видно «Не хватает»), отправки нет.
 */
export function TaskCreateWindow({
  open,
  prefill,
  preview,
  onClose,
}: {
  open: boolean;
  prefill: TaskCreatePrefill | null;
  preview?: TaskCreatePreview;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const canManage = useCanManageWorkflows();
  const create = useCreateTask();
  const { data: creatable, isLoading } = useCreatableProcessTypes();
  const { data: definitions } = useCustomFieldDefinitions('task');
  const initial = useMemo(() => emptyDraft(prefill ?? {}), [prefill]);
  const [draft, setDraft] = useState<TaskCreateDraft>(initial);
  const [invalidKeys, setInvalidKeys] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<CreateFailure | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const projectId = (draft.values.project as string | undefined) ?? prefill?.projectId;
  const structure = useTaskCreateStructure(projectId, prefill?.parentId);
  // След формульного префилла (Р12): какие слоты подставлены формулой и
  // какие человек правил. Живёт в ref — ре-эвал не зависит от идентичности
  // объектов; сбрасывается при каждом открытии окна (A8-4).
  const autoFilledRef = useRef<Record<string, unknown>>({});
  const touchedRef = useRef<Set<string>>(new Set());
  /** Название, подставленное формулой (#496, Р7): ре-эвал заменяет только его. */
  const autoTitleRef = useRef<string | null>(null);

  // Чистое окно при каждом открытии и смене заполнения (плюсик другой
  // колонки) — рендер-тайм сброс, канон React (аудит #45). `seq` — сигнал
  // «черновик пересоздан»: эффект префилла обязан примениться заново, иначе
  // после переоткрытия окно останется без формульных значений.
  const [shownFor, setShownFor] = useState({ open, initial, seq: 0 });
  if (shownFor.open !== open || (open && shownFor.initial !== initial)) {
    setShownFor({ open, initial, seq: shownFor.seq + 1 });
    if (open) {
      setDraft(initial);
      setInvalidKeys(new Set());
      setFailure(null);
      setChecklistOpen(false);
      autoFilledRef.current = {};
      touchedRef.current = new Set();
      autoTitleRef.current = null;
    }
  }

  const types = preview ? [preview.type] : (creatable ?? []);
  const shownType: ProcessType | undefined =
    preview?.type ??
    creatable?.find((type) => type.id === draft.typeId) ??
    defaultTaskType(creatable);
  // Форма — из типа (эффективная форма опубликованного маршрута, Р2), в
  // предпросмотре — черновая форма редактора.
  const form = preview?.form ?? (shownType ? typeCreationFormOf(shownType) : EMPTY_FORM);
  const typesLoading = !preview && isLoading;
  // Префилл формульных слотов (#632, Р12): считается при открытии и смене
  // места (проект/папка/родитель); значение остаётся редактируемым.
  const formulaPrefill = useCreationFormulaPrefill({
    slots: withTitleSlot(form),
    hostKind: shownType?.category === 'letter' ? 'letter' : 'task',
    projectId: projectId ?? null,
    nodeId: draft.nodeId,
    parentId: prefill?.parentId ?? null,
    enabled: open && !preview,
  });
  // Что из черновика подставлено формулой и ещё не тронуто человеком:
  // ре-эвал при смене места обновляет только такие слоты, ручной ввод и
  // осознанная очистка не затираются, а исчезнувший из формулы слот
  // очищается (Р12, A8-3). Название (#496, Р7) — та же логика: формула
  // подставляет, пока человек не тронул поле.
  useEffect(() => {
    if (formulaPrefill.version === 0) return;
    const { title: formulaTitle, ...slotValues } = formulaPrefill.values;
    setDraft((prev) => {
      const applied = applyFormulaPrefill(prev, slotValues, {
        auto: autoFilledRef.current,
        touched: touchedRef.current,
      });
      autoFilledRef.current = applied.auto;
      const titleUntouched =
        !touchedRef.current.has(TITLE_KEY) &&
        (prev.title === '' || prev.title === autoTitleRef.current);
      if (typeof formulaTitle === 'string' && titleUntouched) {
        autoTitleRef.current = formulaTitle;
        return withTitle(applied.draft, formulaTitle);
      }
      return applied.draft;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- версия и seq — сигналы применения
  }, [formulaPrefill.version, shownFor.seq]);

  const missing = shownType ? missingFor(form, draft) : [];
  const missingStructure = structure.required && draft.nodeId === null;
  const canSubmit =
    !preview &&
    draft.title.trim().length > 0 &&
    missing.length === 0 &&
    !missingStructure &&
    !structure.loading &&
    shownType !== undefined;
  const fieldDefs = useMemo(() => definitions ?? [], [definitions]);
  const roleLabels = shownType ? typeConfigOf(shownType).card.roleLabels : undefined;
  const missingText = [
    missingTextOf(missing, form, roleLabels, fieldDefs),
    ...(missingStructure ? [ui.structure.taskNodeLabel] : []),
  ]
    .filter(Boolean)
    .join(', ');
  const missingCount = missing.length + (missingStructure ? 1 : 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const { submit, retryCreate, editDraft } = taskCreateSubmit({
    create,
    draft,
    prefill,
    form,
    canSubmit,
    setDraft,
    setFailure,
    setInvalidKeys,
    queryClient,
    onClose,
  });

  const { fixable, names, canFix, fixing, fixAndCreate } = useTaskCreateSecretFix({
    failure,
    create,
    retryCreate,
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className={cn('gap-0 overflow-hidden p-0', wideWindow(form) ? 'max-w-2xl' : 'max-w-lg')}
        aria-describedby={undefined}
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (checklistOpen) {
            event.preventDefault();
            setChecklistOpen(false);
          } else if ((event.target as Element | null)?.closest?.('[data-esc-local]')) {
            event.preventDefault();
          }
        }}
      >
        <DialogTitle className="sr-only">{ui.taskCreate.title}</DialogTitle>
        <form
          onSubmit={fixable ? fixAndCreate : submit}
          className="relative flex max-h-[80vh] min-w-0 flex-col"
        >
          <div className="flex flex-col gap-3 overflow-y-auto p-4 pb-3">
            <div className="flex min-w-0 items-center gap-2">
              <Input
                value={draft.title}
                onChange={(event) => {
                  touchedRef.current.add(TITLE_KEY);
                  editDraft(withTitle(draft, event.target.value));
                }}
                placeholder={ui.taskCreate.titlePlaceholder}
                aria-label={ui.taskCreate.titlePlaceholder}
                className="h-9 min-w-0 flex-1 text-body-lg"
              />
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground"
                  aria-label={ui.common.close}
                  title={ui.common.close}
                >
                  <X className="size-4" strokeWidth={1.75} />
                </Button>
              </DialogClose>
            </div>

            {prefill?.contextLabel ? (
              <p className="text-xs text-muted-foreground">{prefill.contextLabel}</p>
            ) : null}

            <div className="flex min-w-0 flex-col gap-1.5">
              <NodeLabel label={ui.taskCreate.typeLabel} />
              <ProcessTypeField
                types={types}
                value={shownType?.id ?? ''}
                disabled={Boolean(preview) || typesLoading || types.length === 0}
                showSettings={canManage && !preview}
                dirty={dirty}
                onChange={(typeId) => {
                  editDraft(withType(draft, typeId));
                  setInvalidKeys(new Set());
                }}
                onLeave={onClose}
              />
            </div>

            {typesLoading ? (
              <FormSkeleton />
            ) : shownType ? (
              <TaskCreateFormBody
                type={shownType}
                form={form}
                values={draft.values}
                definitions={fieldDefs}
                invalidKeys={invalidKeys}
                onChange={(key, value) => {
                  // Правка человека — слот больше не формульный: ре-эвал его
                  // не затирает, очистка тоже считается правкой (A8-3).
                  touchedRef.current.add(key);
                  delete autoFilledRef.current[key];
                  const next = withValue(draft, key, value);
                  editDraft(
                    key === 'project' && value !== draft.values.project
                      ? withNode(next, null)
                      : next,
                  );
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{ui.taskCreate.noTypes}</p>
            )}

            <TaskCreateStructure
              structure={structure}
              value={draft.nodeId}
              onChange={(nodeId) => editDraft(withNode(draft, nodeId))}
            />

            <TaskCreateChips
              chips={form.chips}
              draft={draft}
              onChange={editDraft}
              onOpenChecklist={() => setChecklistOpen(true)}
            />

            {failure ? <TaskCreateFailure failure={failure} names={names} canFix={canFix} /> : null}
            {missingCount > 0 ? (
              <p
                id="task-create-missing"
                className="text-xs text-muted-foreground"
                aria-live="polite"
              >
                {ui.taskCreate.missing} <span className="text-foreground">{missingText}</span>
              </p>
            ) : null}
          </div>

          {/* Кнопки окна — СПРАВА, как во всех окнах портала (вердикт
              владельца 07.11.2026): отмена — тихая, «Создать» — primary. */}
          <div className="flex h-12 shrink-0 items-center justify-end gap-2 px-4">
            <Button size="sm" variant="ghost" type="button" onClick={onClose}>
              {ui.common.cancel}
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={!canSubmit || create.isPending || fixing}
              aria-describedby={missingCount > 0 ? 'task-create-missing' : undefined}
            >
              {fixing
                ? ui.taskCreate.secretMembersAdding
                : fixable
                  ? ui.taskCreate.secretMembersAdd
                  : ui.common.create}
            </Button>
          </div>
          {preview ? (
            <p className="px-4 pb-3 text-xs text-muted-foreground">{ui.taskCreate.previewNote}</p>
          ) : null}

          {checklistOpen ? (
            <TaskChecklistSheet
              items={draft.checklist}
              onChange={(items) => editDraft(withChecklist(draft, items))}
              onClose={() => setChecklistOpen(false)}
            />
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
