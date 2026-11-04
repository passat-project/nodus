import { useState } from 'react';
import { Paperclip, Pencil, Plus, X } from 'lucide-react';
import type { LetterAttachedRef, LetterDetail } from '@nodus/contracts';
import { LETTER_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { useUpdateLetter } from '../../api/letters-mutations.js';
import { formatIsoDate } from '../../lib/letter-format.js';
import { AttachedRefDialog, draftOf, type RefDraft } from '../attached-ref-dialog.js';

/**
 * Блок «Приложенные письма» (#461, Р3): строки «№ + организация + дата» —
 * конверт-матрёшка, в котором заказчик присылает пачку писем. Ввод при
 * регистрации и правка канцелярией в карточке; каждая правка — PATCH всего
 * набора (сервер пишет историю счётчиком), оптимистично с откатом. Точный
 * дубль строки и пустая организация — 422 (`duplicate`/`required`).
 * Вложения-файлы сюда не входят: это реестр вложенных ДОКУМЕНТОВ.
 */
export function LetterAttachedRefsBlock({ letter }: { letter: LetterDetail }) {
  const update = useUpdateLetter(letter.id);
  const [editing, setEditing] = useState<{ index: number | null; draft: RefDraft } | null>(null);
  const editable = letter.access.canEdit;
  const refs = letter.attachedRefs;

  const save = (next: LetterAttachedRef[]) => {
    update.mutate({
      body: {
        attachedRefs: next.map((ref) => ({
          number: ref.number,
          counterpartyId: ref.counterparty?.id ?? null,
          orgText: ref.orgText,
          date: ref.date,
        })),
      },
      patch: { attachedRefs: next },
    });
  };

  const commit = (draft: RefDraft) => {
    const number = draft.number.trim();
    const orgText = draft.orgText.trim();
    const org = draft.counterparty?.name ?? (orgText || null);
    if (!number || !org) return;
    const row: LetterAttachedRef = {
      id:
        editing?.index !== null && editing?.index !== undefined
          ? (refs[editing.index]?.id ?? crypto.randomUUID())
          : crypto.randomUUID(),
      number,
      counterparty: draft.counterparty,
      orgText: draft.counterparty ? null : orgText,
      date: draft.date,
    };
    const next =
      editing?.index !== null && editing?.index !== undefined
        ? refs.map((ref, index) => (index === editing.index ? row : ref))
        : [...refs, row];
    save(next);
    setEditing(null);
  };

  const remove = (index: number) => save(refs.filter((_, position) => position !== index));

  return (
    <section className="mt-6">
      <div className="flex items-center gap-2">
        <NodeLabel label={ui.letters.attached.title} count={refs.length} />
        {editable && refs.length < LETTER_LIMITS.attachedRefs ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-1.5 text-muted-foreground"
            onClick={() => setEditing({ index: null, draft: draftOf() })}
          >
            <Plus data-icon="inline-start" />
            {ui.letters.attached.add}
          </Button>
        ) : null}
      </div>
      {refs.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{ui.letters.attached.empty}</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {refs.map((ref, index) => (
            <li
              key={ref.id}
              className="group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-accent/40"
            >
              <Paperclip aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 font-mono text-label-sm tabular-nums">{ref.number}</span>
              <span className="min-w-0 flex-1 truncate text-secondary-foreground">
                {ref.counterparty?.name ?? ref.orgText}
              </span>
              {ref.date ? (
                <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                  {formatIsoDate(ref.date)}
                </span>
              ) : null}
              {editable ? (
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    aria-label={`${ui.letters.card.editHint}: ${ref.number}`}
                    title={ui.letters.card.editHint}
                    onClick={() => setEditing({ index, draft: draftOf(ref) })}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="size-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    aria-label={`${ui.letters.attached.remove}: ${ref.number}`}
                    title={ui.letters.attached.remove}
                    onClick={() => remove(index)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" strokeWidth={1.75} />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <AttachedRefDialog
          draft={editing.draft}
          onCancel={() => setEditing(null)}
          onCommit={commit}
        />
      ) : null}
    </section>
  );
}
