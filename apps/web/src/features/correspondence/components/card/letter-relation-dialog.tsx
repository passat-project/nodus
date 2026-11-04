import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { LetterListItem, LetterRef, LetterRelationKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';

import { useDebouncedValue } from '../../../../shared/lib/use-debounced-value.js';
import { letterRows, useLettersInfinite } from '../../../../shared/api/letters-list.js';
import { relationErrorText, useLinkLetterRelation } from '../../api/letters-relations.js';
import { formatIsoDate } from '../../lib/letter-format.js';

/**
 * Окно «Добавить связь» (#461, Р1а/В2): канцелярия выбирает вид связи
 * («Ответ на» / «Вложено в») и письмо поиском по номеру или теме — только
 * живые зарегистрированные и видимые (сервер фильтрует). Если у письма
 * уже есть связь этого вида, окно честно предупреждает: «заменит
 * существующую» (В4 «возможность поменять»); 422 показывает причину под
 * полем. Повтор той же цели сервер считает успехом — окно просто закрывается.
 */
export function LetterRelationDialog({
  open,
  onOpenChange,
  rootId,
  sourceId,
  initialKind,
  existing,
  excludeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Корень дерева — ключ оптимистичного кэша. */
  rootId: string;
  /** Письмо-источник связи (текущее или узел при «Заменить»). */
  sourceId: string;
  initialKind: LetterRelationKind;
  /** Существующие связи источника по видам: выбранный вид с целью заменит
   *  её (предупреждение в окне, POST с `replace`). */
  existing: Partial<Record<LetterRelationKind, LetterRef>>;
  /** Само письмо-источник — из выдачи поиска исключается. */
  excludeId: string;
}) {
  const [kind, setKind] = useState<LetterRelationKind>(initialKind);
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), 250);
  const [picked, setPicked] = useState<LetterListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const link = useLinkLetterRelation(rootId);
  const letters = useLettersInfinite(null, { search: search || undefined }, { enabled: open });
  const results = letterRows(letters.data)
    .filter((letter) => letter.id !== excludeId)
    .slice(0, 8);

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setQuery('');
      setPicked(null);
      setError(null);
    }
  }, [open, initialKind]);

  const replacedWith = existing[kind] ?? null;
  const replace = replacedWith !== null;
  const kinds: { value: LetterRelationKind; label: string; hint: string }[] = [
    {
      value: 'reply_to',
      label: ui.letters.relations.kindReplyTo,
      hint: ui.letters.relations.kindReplyToHint,
    },
    {
      value: 'nested_in',
      label: ui.letters.relations.kindNestedIn,
      hint: ui.letters.relations.kindNestedInHint,
    },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (link.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg rounded-[14px] p-5">
        <DialogHeader>
          <DialogTitle>
            {replace ? ui.letters.relations.replace : ui.letters.relations.add}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {ui.letters.relations.kindLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          {kinds.map((item) => (
            <label
              key={item.value}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                kind === item.value
                  ? 'border-port bg-accent/50'
                  : 'border-border hover:bg-accent/30',
              )}
            >
              <input
                type="radio"
                name="letter-relation-kind"
                value={item.value}
                checked={kind === item.value}
                onChange={() => setKind(item.value)}
                className="mt-1 accent-[var(--port)]"
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {ui.letters.relations.targetLabel}
          </span>
          {picked ? (
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="flex min-w-0 items-center gap-2 rounded-md border border-port/60 bg-accent/40 px-2.5 py-1.5 text-left text-sm"
              title={ui.letters.relations.targetLabel}
            >
              <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                {picked.regNumber ?? ui.letters.noNumber}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {picked.subject ?? ui.letters.noSubject}
              </span>
              <span aria-hidden className="shrink-0 text-muted-foreground">
                ×
              </span>
            </button>
          ) : (
            <>
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setError(null);
                  }}
                  placeholder={ui.letters.relations.targetPlaceholder}
                  aria-label={ui.letters.relations.targetLabel}
                  className="h-8 pl-8 text-sm"
                />
              </div>
              <div className="flex max-h-48 flex-col overflow-y-auto">
                {results.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    {search ? ui.letters.relations.targetNotFound : ui.letters.relations.empty}
                  </p>
                ) : (
                  results.map((letter) => (
                    <button
                      key={letter.id}
                      type="button"
                      onClick={() => setPicked(letter)}
                      className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent/50"
                    >
                      <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                        {letter.regNumber ?? ui.letters.noNumber}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {letter.subject ?? ui.letters.noSubject}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {letter.regDate ? formatIsoDate(letter.regDate) : ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
          {replace && picked ? (
            <p className="text-xs text-warning">
              {ui.letters.relations.replaceWarning(
                replacedWith.regNumber ?? replacedWith.subject ?? ui.letters.noNumber,
              )}
            </p>
          ) : null}
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={link.isPending}>
            {ui.common.cancel}
          </Button>
          <Button
            disabled={!picked || link.isPending}
            aria-busy={link.isPending || undefined}
            onClick={() => {
              if (!picked) return;
              setError(null);
              link.mutate(
                { sourceId, target: picked, kind, replace },
                {
                  onSuccess: () => onOpenChange(false),
                  onError: (mutationError) => setError(relationErrorText(mutationError)),
                },
              );
            }}
          >
            {ui.letters.relations.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
