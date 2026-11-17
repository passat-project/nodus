import { useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, Loader2, X } from 'lucide-react';
import { ui, type AssistantToolCall } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { openCardViaBridge } from '../../../shared/lib/card-bridge.js';

const strings = ui.assistant;

/**
 * Вызовы инструментов в ленте (#895, вердикт владельца 17.11.2026): строка
 * ОДНОГО вида, как в харнесах — действие и длительность; вывод инструмента
 * по умолчанию НЕ показывается вовсе. Клик по строке раскрывает параметры
 * вызова и результат; внутри раскрытой части кнопок нет — единственное
 * действие строки это раскрытие.
 *
 * `ui.open_entity` — НЕ строка тула: это навигационная директива, её кнопка
 * живёт под ответом (`AssistantEntityLinks`), а не в списке действий.
 */
export function AssistantToolRows({ tools }: { tools: readonly AssistantToolCall[] }) {
  const rows = tools.filter((tool) => tool.toolId !== 'ui.open_entity');
  if (rows.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-col gap-0.5">
      {rows.map((tool) => (
        <AssistantToolRow key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

/**
 * Переходы в карточки под ОТВЕТОМ (а не в строке вызова): сотрудник видит
 * действие там, где читает результат. Адрес — внутренний `?cards=kind:id`
 * из проверенных вида и id; списки ссылок не дают (только карточка).
 */
export function AssistantEntityLinks({ tools }: { tools: readonly AssistantToolCall[] }) {
  const links = tools.filter((tool) => tool.toolId === 'ui.open_entity' && tool.href);
  if (links.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1 pl-9">
      {links.map((tool) => (
        <OpenEntityButton key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function AssistantToolRow({ tool }: { tool: AssistantToolCall }) {
  const [open, setOpen] = useState(false);
  const args = tool.args !== null ? formatArgs(tool.args) : null;
  const expandable = Boolean(args) || Boolean(tool.resultPreview);

  return (
    <div className={cn('text-label', tool.status === 'error' && 'text-destructive')}>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left',
          expandable && 'hover:bg-muted/50',
        )}
      >
        {expandable ? (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <ToolStatusIcon status={tool.status} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-medium',
            tool.status === 'error' ? 'text-destructive' : 'text-foreground',
          )}
        >
          {tool.title}
        </span>
        {tool.durationMs !== null ? (
          <span className="shrink-0 font-mono text-badge text-muted-foreground tabular-nums">
            {tool.durationMs} {strings.ms}
          </span>
        ) : null}
      </button>
      {open && expandable ? (
        <div className="mt-1 mr-1 mb-1 ml-6 rounded-md bg-muted/40 px-2 py-1.5">
          {args ? (
            <p className="text-badge text-muted-foreground">
              <span className="font-medium">{strings.toolDetails}: </span>
              {args}
            </p>
          ) : null}
          {tool.resultPreview ? (
            <p
              className={cn(
                'max-h-56 overflow-auto whitespace-pre-wrap break-words text-badge leading-relaxed text-muted-foreground',
                args && 'mt-1',
              )}
            >
              {tool.resultPreview}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Явная кнопка перехода: единственное «кликабельное» действие в карточке хода. */
function OpenEntityButton({ tool }: { tool: AssistantToolCall }) {
  return (
    <button
      type="button"
      onClick={() => openCardFromHref(tool.href!)}
      className="flex w-fit items-center gap-1 rounded-md border border-border px-2 py-1 text-label text-foreground hover:bg-accent"
    >
      <ArrowUpRight className="size-3 shrink-0 text-primary" />
      {strings.open}
      {tool.hrefLabel ? `: ${tool.hrefLabel}` : ''}
    </button>
  );
}

/** Параметры вызова — человеческой строкой (`limit: 20 · scope: mine`), не JSON. */
export function formatArgs(args: Record<string, unknown>): string | null {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  return entries
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(' · ')
    .slice(0, 200);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value).slice(0, 60);
}

function ToolStatusIcon({ status }: { status: AssistantToolCall['status'] }) {
  if (status === 'running') {
    return <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (status === 'error') return <X className="size-3 shrink-0 text-destructive" />;
  return <Check className="size-3 shrink-0 text-primary" />;
}

/**
 * Переход «Открыть»: адрес приходит с сервера в форме `?cards=kind:id`
 * (собран из проверенных вида и id, не из текста модели). Разбираем и
 * открываем карточку через мост каркаса — без редиректов и внешних ссылок.
 */
export function openCardFromHref(href: string): void {
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : href;
  const value = new URLSearchParams(query).get('cards');
  if (!value) return;
  const ref = value.split(',').at(-1) ?? '';
  const separator = ref.indexOf(':');
  if (separator <= 0) return;
  const kind = ref.slice(0, separator);
  const id = ref.slice(separator + 1);
  if (!id) return;
  openCardViaBridge({ kind, id });
}
