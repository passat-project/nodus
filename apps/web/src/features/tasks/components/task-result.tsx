import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { TaskDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Textarea } from '@nodus/ui/components/textarea';

import { useTaskConversation } from '../../../shared/chat/chat-queries.js';
import { formatDateTime, withoutPatronymic } from '../../../shared/lib/format.js';
import { TaskResultView } from '../../../shared/tasks/task-result-view.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { useSaveTaskResult } from '../api/task-edit-api.js';

/** Результат задачи (Битрикс24 «Результат», гейт DoD `result_present`):
 *  текст итога + сообщения обсуждения, отмеченные «Отметить как результат».
 *  Ревизии append-only: правка — новая ревизия (сообщения сохраняются).
 *  Писать могут постановщик, ответственный и соисполнители (`canCheck`). */
export function TaskResultSection({ task }: { task: TaskDetail }) {
  const save = useSaveTaskResult(task.id);
  const { data: conversation } = useTaskConversation(task.id);
  const [draft, setDraft] = useState<string | null>(null);
  const result = task.result;
  // Сбор отметок закрыт: итог — вклад каждого участника, а не текст последнего
  // (#965). Так результат выбывшего остаётся подписан его автором.
  const collected = task.press?.completed
    ? task.press.entries.filter((entry) => entry.result?.text.trim())
    : [];
  const canWrite = task.access.canCheck && collected.length === 0;

  function submit() {
    if (draft === null) return;
    const text = draft.trim();
    save.mutate(
      { text, messageIds: result?.messageIds ?? [] },
      { onSuccess: () => setDraft(null) },
    );
  }

  return (
    <section className="mt-7">
      <div className="flex h-7 items-center gap-3">
        <NodeLabel label={ui.tasks.result} />
        {canWrite && result && draft === null ? (
          <button
            type="button"
            onClick={() => setDraft(result.text)}
            className="ml-auto rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {ui.tasks.resultEdit}
          </button>
        ) : null}
      </div>
      {draft !== null ? (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea
            autoFocus
            value={draft}
            maxLength={5000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setDraft(null);
              }
            }}
            placeholder={ui.tasks.resultPlaceholder}
            aria-label={ui.tasks.result}
            className="min-h-20 text-sm leading-relaxed [field-sizing:content]"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={submit} disabled={save.isPending}>
              {ui.common.save}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              {ui.common.cancel}
            </Button>
          </div>
        </div>
      ) : collected.length > 0 ? (
        <div className="mt-2 rounded-lg bg-success-soft/40 px-3 py-2.5">
          {collected.map((entry, index) => (
            <div
              key={entry.userId}
              className={index > 0 ? 'mt-3 border-t border-border/60 pt-3' : undefined}
            >
              <p className="text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap">
                {entry.result?.text}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <PersonAvatar
                  name={entry.displayName}
                  avatarUrl={entry.avatarUrl}
                  className="size-4"
                  decorative
                />
                {withoutPatronymic(entry.displayName)} ·{' '}
                {entry.pressedAt ? formatDateTime(entry.pressedAt) : '—'}
                {entry.state === 'excluded' ? (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[11px]">
                    {ui.tasks.press.resultRetained}
                  </span>
                ) : null}
              </p>
            </div>
          ))}
        </div>
      ) : result ? (
        <div className="mt-2 rounded-lg bg-success-soft/40 px-3 py-2.5">
          <TaskResultView result={result} conversationId={conversation?.id ?? null} />
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <PersonAvatar
              name={result.author.displayName}
              avatarUrl={result.author.avatarUrl}
              className="size-4"
            />
            {withoutPatronymic(result.author.displayName)} · {formatDateTime(result.createdAt)}
          </p>
        </div>
      ) : canWrite ? (
        <button
          type="button"
          onClick={() => setDraft('')}
          className="-mx-1 mt-1 flex items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
          {ui.tasks.resultAdd}
          <span className="hidden text-xs text-muted-foreground/80 @min-[40rem]:inline">
            — {ui.tasks.resultEmpty}
          </span>
        </button>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{ui.common.notSet}</p>
      )}
    </section>
  );
}
