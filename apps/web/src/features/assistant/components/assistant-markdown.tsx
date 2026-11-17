import { memo, useCallback, useDeferredValue, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { cardRefFromHref } from './assistant-card-link.js';
import { openCardFromHref } from './assistant-tool-rows.js';

const strings = ui.assistant;

/**
 * Markdown-ответ ассистента (ADR-0045, #897): GFM (списки, таблицы, код,
 * ссылки) с ОБЯЗАТЕЛЬНЫМ санитайзером — ответ модели недоверенный, она
 * пересказывает письма и сообщения портала.
 *
 * Почему так:
 * - `react-markdown` строит React-элементы (никакого `dangerouslySetInnerHTML`),
 *   `rehype-sanitize` — второй слой на случай расширения схемы; `rehype-raw`
 *   НЕ подключён, поэтому сырой HTML из данных в дерево не попадает;
 * - изображения не рендерятся: `![x](https://…)` дал бы автозагрузку внешнего
 *   ресурса (трекинг, утечка через URL) — раздел issue «изображения не входят»,
 *   а письма в портале внешние картинки тоже блокируют (ADR-0027);
 * - ссылки: внешние — `https?` в новой вкладке с `noopener noreferrer`;
 *   внутренние `?cards=` — через мост карточек (без редиректа страницы) и
 *   только с проверенным видом и UUID (`assistant-card-link.ts`);
 *   прочие протоколы отбрасываются `defaultUrlTransform`;
 * - стриминг: текст приходит дельтами, рендер отложен `useDeferredValue`
 *   (парсинг документа на каждый кадр заблокировал бы ленту); компонент
 *   мемоизирован, а набор компонентов — модульная константа: иначе лента
 *   перепарсивала бы ВСЕ видимые ответы на каждую дельту;
 * - таблица — горизонтальный скролл ВНУТРИ пузыря (ширина окна не ломается),
 *   код-блок — кнопка «Копировать».
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: { text: string }) {
  // Парсинг полного документа на каждую дельту — дорого; отложенное значение
  // отдаёт приоритет кадрам стриминга (официальный код react-markdown парсит
  // строку целиком синхронно, инкрементального парсинга нет).
  const deferred = useDeferredValue(text);
  return (
    <div className="min-w-0 text-sm leading-relaxed break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        urlTransform={safeUrl}
        components={MARKDOWN_COMPONENTS}
      >
        {deferred}
      </Markdown>
    </div>
  );
});

/** URL markdown: только безопасные протоколы (javascript:/data: отбрасываются). */
function safeUrl(url: string): string {
  return defaultUrlTransform(url);
}

/**
 * Ссылка ответа: внешняя — в новой вкладке, внутренняя карточка
 * (`?cards=kind:<uuid>`) — через мост (страница не перезагружается).
 * Внешний URL с подстрокой `cards=` карточкой НЕ считается.
 */
function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (!href) return <span>{children}</span>;
  const internal = cardRefFromHref(href) !== null;
  return (
    <a
      href={href}
      target={internal ? undefined : '_blank'}
      rel={internal ? undefined : 'noopener noreferrer'}
      className="text-info wrap-anywhere underline underline-offset-2 hover:underline"
      onClick={(event) => {
        if (!internal) return;
        event.preventDefault();
        openCardFromHref(href);
      }}
    >
      {children}
    </a>
  );
}

/** Код-блок: моно-ширина + «Копировать» (подсветки синтаксиса в v1 нет). */
function MarkdownPre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // Кнопка — сосед <pre> внутри обёртки, а не потомок: closest('pre')
    // возвращал null и копирование молча клало пустую строку.
    const text = event.currentTarget.parentElement?.querySelector('pre')?.textContent ?? '';
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }, []);
  return (
    <div className="group/code relative my-1.5 min-w-0">
      <pre className="overflow-x-auto rounded-lg bg-muted px-2.5 py-2 font-mono text-label-sm leading-relaxed">
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={strings.markdownCopy}
        title={strings.markdownCopy}
        className={cn(
          'absolute top-1 right-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-badge text-muted-foreground',
          'opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100',
          'hover:bg-accent hover:text-foreground',
        )}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? strings.markdownCopied : null}
      </button>
    </div>
  );
}

/** Таблица — компактная, скролл внутри пузыря (окно не расширяет). */
function MarkdownTable({ children }: { children?: ReactNode }) {
  return (
    <div className="my-2 min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-label-sm">{children}</table>
    </div>
  );
}

/**
 * Набор компонентов — константа модуля (не новый объект на рендер): иначе
 * react-markdown считает типы компонентов изменившимися и перемонтирует DOM
 * на каждой дельте стриминга.
 */
const MARKDOWN_COMPONENTS = {
  // Изображения не показываем: автозагрузка внешнего URL — канал трекинга и
  // эксфильтрации из недоверенного ответа (находка security-ревью #897).
  img: () => null,
  a: MarkdownLink,
  pre: MarkdownPre,
  table: MarkdownTable,
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border-b border-border px-2 py-1 text-left font-medium text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border-b border-border/60 px-2 py-1 align-top">{children}</td>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="my-1 first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-1 list-disc pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-1 list-decimal pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className="my-0.5">{children}</li>,
  h1: ({ children }: { children?: ReactNode }) => (
    <h3 className="mt-2 mb-1 text-base font-semibold">{children}</h3>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h3 className="mt-2 mb-1 text-base font-semibold">{children}</h3>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-1.5 border-l-2 border-border pl-2.5 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2 border-border" />,
  code: ({ children, className }: { children?: ReactNode; className?: string }) =>
    className ? (
      <code className="font-mono text-label-sm">{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">{children}</code>
    ),
};
