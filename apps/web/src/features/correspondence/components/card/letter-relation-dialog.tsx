import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type {
  LetterListItem,
  LetterRef,
  LetterRelationKind,
  LetterTreeNode,
} from '@nodus/contracts';
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
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { ApiError } from '../../../../shared/api-client.js';
import { letterRows, useLettersInfinite } from '../../../../shared/api/letters-list.js';
import { useDebouncedValue } from '../../../../shared/lib/use-debounced-value.js';
import { relationErrorText, useLinkLetterRelation } from '../../api/letters-relations.js';
import { treeNodeOf } from '../../lib/letter-tree.js';
import { RelationModeChoices } from './letter-relation-mode-choices.js';
import { nodeNumber } from './letter-relation-node.js';
import { LetterPickRow } from './letter-relation-pick.js';
import { RelationPickedCard } from './letter-relation-picked-card.js';

/** Показываем первые совпадения: окно — выбор, не реестр. */
const RESULTS_LIMIT = 8;

const isAlreadyLinked = (error: unknown) =>
  error instanceof ApiError && error.details?.reason === 'already_linked';

/**
 * Окно «Добавить связь» / «Заменить связь» (#461, Р1а/В2): канцелярия
 * выбирает вид связи («Ответ на» / «Вложено в») и письмо поиском по номеру,
 * теме или № приложенного — только зарегистрированные и видимые (сервер
 * фильтрует и перепроверяет). Связь того же вида у письма уже есть — окно
 * честно предупреждает «заменит существующую» (В4); сервер сообщил о
 * связи, которой не видно в дереве (`already_linked`), — окно переходит в
 * замену. Прочие 422 — под полем. Зона выдачи фиксированной высоты (канон
 * пикеров: окно не прыгает при поиске); ↑/↓ и Enter — выбор с клавиатуры.
 */
export function LetterRelationDialog({
  open,
  onOpenChange,
  rootId,
  source,
  initialKind,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Корень дерева — ключ оптимистичного кэша. */
  rootId: string;
  /** Письмо-источник связи (текущее или узел при «Заменить»). */
  source: LetterTreeNode;
  initialKind: LetterRelationKind;
  /** Существующие связи источника по видам: выбранный вид с целью заменит
   *  её (предупреждение в окне, POST с `replace`). */
  existing: Partial<Record<LetterRelationKind, LetterRef>>;
}) {
  const [kind, setKind] = useState<LetterRelationKind>(initialKind);
  /** Направление (#611): по умолчанию — как раньше, выбранное становится
   *  родителем; обратное — добавляем выбранное письмо ребёнком к открытому. */
  const [direction, setDirection] = useState<'fromCurrent' | 'toCurrent'>('fromCurrent');
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), 250);
  const [picked, setPicked] = useState<LetterListItem | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Сервер знает связь вида, которой нет в дереве: замена по согласию. */
  const [unknownLink, setUnknownLink] = useState<LetterRelationKind | null>(null);
  const link = useLinkLetterRelation(rootId);
  const letters = useLettersInfinite(null, { search: search || undefined }, { enabled: open });
  const results = letterRows(letters.data)
    .filter((letter) => letter.id !== source.id && letter.regNumber !== null)
    .slice(0, RESULTS_LIMIT);

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setDirection('fromCurrent');
      setQuery('');
      setPicked(null);
      setError(null);
      setUnknownLink(null);
    }
  }, [open, initialKind]);
  useEffect(() => setActive(0), [search]);

  // Замена относится к связям ОТКРЫТОГО письма: в обратном направлении
  // связи выбранного окну неизвестны — замену предлагаем в его карточке.
  const fromCurrent = direction === 'fromCurrent';
  const replacedWith = fromCurrent ? (existing[kind] ?? null) : null;
  const replace = replacedWith !== null || (fromCurrent && unknownLink === kind);

  const pick = (letter: LetterListItem) => {
    setPicked(letter);
    setError(null);
  };

  const submit = () => {
    if (!picked || link.isPending) return;
    setError(null);
    // Направление задаёт, кто получает связь: открытое письмо (как раньше)
    // или выбранное (добавляем ребёнка к открытому) — сервер тот же.
    link.mutate(
      fromCurrent
        ? {
            sourceId: source.id,
            targetId: picked.id,
            parentNode: treeNodeOf(picked),
            kind,
            replace,
          }
        : {
            sourceId: picked.id,
            targetId: source.id,
            parentNode: source,
            kind,
            replace: false,
          },
      {
        onSuccess: () => onOpenChange(false),
        onError: (mutationError) => {
          if (isAlreadyLinked(mutationError)) {
            // В обратном направлении замену предлагает карточка выбранного.
            if (fromCurrent && !replace) setUnknownLink(kind);
            else setError(ui.letters.relations.alreadyLinkedTarget);
          } else setError(relationErrorText(mutationError));
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (link.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="grid-cols-[minmax(0,1fr)] rounded-[14px] p-5 sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>
            {existing[initialKind] && initialKind === kind && fromCurrent
              ? ui.letters.relations.replaceTitle
              : ui.letters.relations.addTitle}
          </DialogTitle>
          <DialogDescription className="flex min-w-0 items-center gap-2">
            <span className="shrink-0">{ui.letters.relations.sourceLine}</span>
            <span className="shrink-0 font-mono text-label-sm tabular-nums">
              {nodeNumber(source)}
            </span>
            <span className="min-w-0 truncate text-foreground">
              {source.subject ?? ui.letters.noSubject}
            </span>
          </DialogDescription>
        </DialogHeader>

        <RelationModeChoices
          kind={kind}
          direction={direction}
          disabled={link.isPending}
          onKind={(next) => {
            setKind(next);
            setError(null);
          }}
          onDirection={(next) => {
            setDirection(next);
            setError(null);
          }}
        />

        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {ui.letters.relations.targetLabel}
          </span>
          {/* Зона выбора — фиксированной высоты в обоих режимах (поиск /
              выбранное): окно не прыгает ни при поиске, ни при выборе. */}
          <div className={cn('flex h-64 min-w-0 flex-col gap-2', picked && 'justify-center')}>
            {picked ? (
              <RelationPickedCard
                picked={picked}
                source={source}
                kind={kind}
                direction={direction}
                replace={replace}
                replacedWith={replacedWith}
                disabled={link.isPending}
                onClear={() => setPicked(null)}
              />
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
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        const step = event.key === 'ArrowDown' ? 1 : -1;
                        setActive((index) =>
                          results.length === 0
                            ? 0
                            : (index + step + results.length) % results.length,
                        );
                      }
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        const letter = results[active];
                        if (letter) pick(letter);
                      }
                    }}
                    placeholder={ui.letters.relations.targetPlaceholder}
                    aria-label={ui.letters.relations.targetLabel}
                    aria-controls="letter-relation-results"
                    className="h-8 pl-8 text-sm"
                  />
                </div>
                <div
                  id="letter-relation-results"
                  role="listbox"
                  aria-label={ui.letters.relations.targetLabel}
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto"
                >
                  {letters.isLoading ? (
                    <div className="flex flex-col gap-3 px-2 py-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-4 w-3/5" />
                    </div>
                  ) : results.length === 0 ? (
                    <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      {ui.letters.relations.targetNotFound}
                    </p>
                  ) : (
                    results.map((letter, index) => (
                      <button
                        key={letter.id}
                        type="button"
                        role="option"
                        aria-selected={index === active}
                        onClick={() => pick(letter)}
                        onPointerEnter={() => setActive(index)}
                        className={cn(
                          'flex min-w-0 shrink-0 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors',
                          index === active && 'bg-accent',
                        )}
                      >
                        <LetterPickRow letter={letter} />
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={link.isPending}>
            {ui.common.cancel}
          </Button>
          <Button
            disabled={!picked || link.isPending}
            aria-busy={link.isPending || undefined}
            onClick={submit}
          >
            {replace ? ui.letters.relations.submitReplace : ui.letters.relations.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
