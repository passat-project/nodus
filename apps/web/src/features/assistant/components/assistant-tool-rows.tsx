import { useState } from 'react';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { ui, type AssistantToolCall } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { openCardViaBridge } from '../../../shared/lib/card-bridge.js';

const strings = ui.assistant;

/**
 * Строка вызова инструмента в ленте (#895): что именно сделал ассистент —
 * имя действия, статус, краткий результат. Аргументы раскрываются по клику
 * (прозрачность: видно, какие фильтры запрошены). Кнопка «Открыть» ведёт в
 * карточку сущности (адрес — только внутренний, `?cards=kind:id`).
 */
export function AssistantToolRows({ tools }: { tools: readonly AssistantToolCall[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-col gap-1">
      {tools.map((tool) => (
        <AssistantToolRow key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function AssistantToolRow({ tool }: { tool: AssistantToolCall }) {
  const [open, setOpen] = useState(false);
  const hasArgs = tool.args && Object.keys(tool.args).length > 0;
  return (
    <div
      className={cn(
        'rounded-lg border border-border/70 bg-card/60 px-2 py-1.5 text-label',
        tool.status === 'error' && 'border-destructive/40',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => (hasArgs ? setOpen((value) => !value) : undefined)}
        aria-expanded={hasArgs ? open : undefined}
      >
        {hasArgs ? (
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
        <span className="min-w-0 flex-1 truncate text-foreground">{tool.title}</span>
        {tool.durationMs !== null ? (
          <span className="shrink-0 font-mono text-badge text-muted-foreground tabular-nums">
            {tool.durationMs} {strings.ms}
          </span>
        ) : null}
      </button>
      {open && hasArgs ? (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words px-4 font-mono text-badge text-muted-foreground">
          {JSON.stringify(tool.args, null, 2)}
        </pre>
      ) : null}
      {tool.resultPreview ? (
        <p className="mt-1 line-clamp-2 px-4 text-badge leading-snug text-muted-foreground">
          {tool.resultPreview}
        </p>
      ) : null}
      {tool.href ? (
        <button
          type="button"
          className="mt-1 px-4 text-badge font-medium text-primary hover:underline"
          onClick={() => openCardFromHref(tool.href!)}
        >
          {strings.open}
          {tool.hrefLabel ? `: ${tool.hrefLabel}` : ''}
        </button>
      ) : null}
    </div>
  );
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
