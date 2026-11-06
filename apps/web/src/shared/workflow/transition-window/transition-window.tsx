import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  EffectiveSection,
  ExecuteTransitionBody,
  TransitionBlockReason,
  WorkflowTransition,
} from '@nodus/contracts';
import { effectiveWindowSections, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Textarea } from '@nodus/ui/components/textarea';

import { useMessagesLookup } from '../../chat/message-lookup-api.js';
import { buildExecuteBody } from './build-execute-body.js';
import { ConditionsList } from './conditions-list.js';
import type { GateDetailsHost } from './gate-details.js';
import { SubmissionBlock } from './submission-block.js';
import { useWindowDraft, draftMessageIds } from './use-window-draft.js';
import {
  windowCanSubmit,
  windowConditionLines,
  type WindowConditionLine,
} from './window-conditions.js';
import type { TransitionWindowContext } from './window-context.js';
import {
  WindowSection,
  type RenderWindowSection,
  type WindowSectionApi,
} from './window-sections.js';

/** Ошибка отправки, которую окно показывает у себя (422/409 от сервера). */
export interface TransitionWindowError {
  missing?: string[];
  reasons?: TransitionBlockReason[];
}

const PREVIEW_CONTEXT: TransitionWindowContext = {
  entityId: '',
  conversationId: null,
  currentStageName: '—',
  fields: {
    description: '',
    deadline: null,
    assigneeId: null,
    plannedMinutes: null,
    customFields: {},
  },
  spentMinutes: 0,
  lastResult: null,
  access: { canEdit: true, canLogTime: true, canCheck: true },
  submission: null,
  scope: 'entity',
  customFieldDefinitions: [],
  customFieldRefs: [],
};

/**
 * Окно перехода (#380): диалог по центру (≈640, радиус 14, канон диалогов),
 * разделы по настройке кнопки ∪ гейтам, живой список условий, пессимистичная
 * отправка. Закрытие — «Отмена» или Esc; клик мимо окна не закрывает.
 * `mode="preview"` — настоящее окно без данных (редактор маршрутов).
 */
export function TransitionWindow({
  open,
  mode,
  transition,
  context,
  submitting,
  error,
  onCancel,
  onSubmit,
  onOpenChecklist,
  onOpenSubtasks,
  gate,
  renderSection,
}: {
  open: boolean;
  mode: 'live' | 'preview';
  transition: WorkflowTransition;
  context: TransitionWindowContext | null;
  submitting?: boolean;
  error?: TransitionWindowError | null;
  onCancel: () => void;
  onSubmit: (body: ExecuteTransitionBody, override?: { override: true; reason: string }) => void;
  onOpenChecklist?: () => void;
  onOpenSubtasks?: () => void;
  gate?: GateDetailsHost;
  /** Разделы сущности, которые рисует хост (регистрация письма, #55). */
  renderSection?: RenderWindowSection;
}) {
  const effectiveContext = mode === 'preview' ? (context ?? PREVIEW_CONTEXT) : context;
  const {
    draft,
    setFields,
    setTime,
    setResultText,
    setComment,
    setRegistration,
    addFiles,
    toggleFile,
    toggleMessage,
  } = useWindowDraft(effectiveContext, transition.formPrefill);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const sections = useMemo(
    () => effectiveWindowSections(transition.form, { validators: transition.validators }),
    [transition.form, transition.validators],
  );
  const conversationId = effectiveContext?.conversationId ?? null;
  const resultIds = draftMessageIds(draft);
  const { data: resultMessages } = useMessagesLookup(
    conversationId,
    resultIds,
    conversationId !== null,
  );
  const attachmentCount = (resultMessages?.items ?? []).reduce(
    (sum, message) =>
      sum + message.attachments.filter((a) => a.kind === 'image' || a.kind === 'file').length,
    0,
  );

  const lines = useMemo<WindowConditionLine[]>(
    () =>
      effectiveContext
        ? windowConditionLines({
            transition,
            context: effectiveContext,
            draft,
            attachmentCount,
          })
        : [],
    [transition, effectiveContext, draft, attachmentCount],
  );
  const canSubmit = effectiveContext ? windowCanSubmit({ sections, lines, draft }) : false;
  const allOk = lines.every((line) => line.ok);
  const canOverride = mode === 'live' && transition.canOverride && !allOk;

  const api: WindowSectionApi | null = effectiveContext
    ? {
        context: effectiveContext,
        draft,
        disabled: mode === 'preview' || Boolean(submitting),
        focusResult: sections.some((s) => s.kind === 'result') && !draft.resultText.trim(),
        focusComment:
          sections.some((s) => s.kind === 'comment' && s.required) && !draft.comment.trim(),
        setFields,
        setTime,
        setResultText,
        setComment,
        addFiles,
        toggleFile,
        toggleMessage,
        setRegistration,
        renderSection: mode === 'live' ? renderSection : undefined,
      }
    : null;

  function submit() {
    if (!api || !canSubmit || submitting || mode === 'preview') return;
    const body = buildExecuteBody({ sections, context: api.context, draft });
    onSubmit(body);
  }

  function submitOverride() {
    if (!api || submitting || !overrideReason.trim()) return;
    const body = buildExecuteBody({ sections, context: api.context, draft });
    onSubmit(body, { override: true, reason: overrideReason.trim() });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        // Ctrl/⌘+Enter — главная кнопка окна (как в конвейере «Новые», #55).
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }}
        className="flex max-h-[90vh] max-w-[640px] flex-col gap-4 overflow-hidden rounded-[14px] p-5 sm:max-w-[640px]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{transition.form?.title || transition.name}</DialogTitle>
          <DialogDescription>
            {effectiveContext?.currentStageName} {ui.tasks.window.stageArrow}{' '}
            {transition.toStageName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {effectiveContext?.submission ? (
            <SubmissionBlock
              submission={effectiveContext.submission}
              conversationId={effectiveContext.conversationId}
            />
          ) : null}

          {api ? (
            <div className="flex flex-col gap-4">
              {sections.map((section) => (
                <section key={section.kind} className="flex flex-col gap-1.5">
                  <NodeLabel label={sectionTitle(section)} />
                  <WindowSection section={section} api={api} />
                </section>
              ))}
            </div>
          ) : null}

          {error ? (
            <p className="text-xs text-danger" role="alert">
              {ui.tasks.window.submitFailed}
              {error.missing && error.missing.length > 0
                ? ` (${error.missing.map(missingLabel).join(', ')})`
                : ''}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t-0 pt-1">
          <ConditionsList
            lines={lines}
            reasons={transition.blockedBy}
            gate={gate}
            onOpenChecklist={onOpenChecklist}
            onOpenSubtasks={onOpenSubtasks}
          />
          {canOverride && overrideOpen ? (
            <Textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              maxLength={500}
              placeholder={ui.tasks.overrideReason}
              aria-label={ui.tasks.overrideReason}
              className="min-h-14 text-sm"
            />
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={onCancel} disabled={Boolean(submitting)}>
              {ui.common.cancel}
            </Button>
            {canOverride && !overrideOpen ? (
              <Button variant="outline" onClick={() => setOverrideOpen(true)}>
                {ui.tasks.overrideGate}
              </Button>
            ) : null}
            {canOverride && overrideOpen ? (
              <Button
                variant="outline"
                disabled={!overrideReason.trim() || submitting}
                onClick={submitOverride}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" strokeWidth={1.75} /> : null}
                {ui.tasks.overrideGate}
              </Button>
            ) : null}
            <Button
              disabled={!canSubmit || Boolean(submitting) || mode === 'preview'}
              onClick={submit}
              aria-busy={submitting || undefined}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" strokeWidth={1.75} /> : null}
              {transition.name}
            </Button>
          </DialogFooter>
          {mode === 'preview' ? (
            <p className="text-xs text-muted-foreground">{ui.tasks.window.previewNote}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function sectionTitle(section: EffectiveSection): string {
  switch (section.kind) {
    case 'registration':
      return ui.automation.window.sections.registration;
    case 'fields':
      return ui.tasks.window.fieldsLabel;
    case 'time':
      return ui.tasks.window.timeLabel;
    case 'result':
      return ui.tasks.window.resultLabel;
    case 'result_files':
      return section.label || ui.tasks.window.filesLabel;
    case 'result_messages':
      return ui.tasks.window.messagesLabel;
    case 'comment':
      return section.label || ui.tasks.window.commentLabel;
  }
}

function missingLabel(key: string): string {
  switch (key) {
    case 'comment':
      return ui.tasks.window.commentLabel;
    case 'result_messages':
      return ui.tasks.window.messagesLabel;
    case 'registration':
      return ui.automation.window.sections.registration;
    default:
      return key;
  }
}
