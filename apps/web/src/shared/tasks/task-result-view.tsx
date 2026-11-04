import { FileText, MessageSquareQuote } from 'lucide-react';
import type { ChatMessage, MessageAttachment } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { LinkifiedText } from '../chat/message-text.js';
import { useMessagesLookup } from '../chat/message-lookup-api.js';
import { toViewerTarget } from '../chat/vault-list.js';
import { useViewerHost } from '../files/viewer-host.js';
import { plural } from '../lib/format.js';

/** Данные ревизии итога для показа (общая форма DTO задачи и блока сдачи). */
export interface TaskResultViewData {
  text: string;
  messageIds: string[];
}

/**
 * Итог работы (результат задачи, #380): текст, файлы миниатюрами и
 * сообщения-отчёт. Файлы задачи живут вложениями её чата (канон #252) —
 * DTO вложений (подписанные ссылки, превью) строит только чат, поэтому
 * сообщения читаются lookup'ом по id (только участник беседы). Не участник
 * или нет беседы — прежний счётчик «N сообщений» (переписка не раскрывается).
 */
export function TaskResultView({
  result,
  conversationId,
  className,
}: {
  result: TaskResultViewData;
  conversationId: string | null;
  className?: string;
}) {
  const { data } = useMessagesLookup(conversationId, result.messageIds, conversationId !== null);
  const messages = data?.items ?? [];
  const attachments = messages.flatMap((m) =>
    m.attachments.filter((a) => a.kind === 'image' || a.kind === 'file'),
  );
  const messagesWithAttachments = new Set(
    messages.filter((m) => m.attachments.length > 0).map((m) => m.id),
  );
  const plainMessages = messages.filter((m) => !messagesWithAttachments.has(m.id));

  return (
    <div className={className}>
      {result.text ? (
        <p className="text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap">
          <LinkifiedText text={result.text} />
        </p>
      ) : null}
      {attachments.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <ResultAttachment key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
      {plainMessages.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1">
          {plainMessages.map((message) => (
            <ResultMessage key={message.id} message={message} />
          ))}
        </div>
      ) : null}
      {messages.length === 0 && result.messageIds.length > 0 ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageSquareQuote className="size-3.5" strokeWidth={1.75} />
          {result.messageIds.length}{' '}
          {plural(result.messageIds.length, ui.tasks.resultMessagesForms)}
        </p>
      ) : null}
    </div>
  );
}

function ResultAttachment({ attachment }: { attachment: MessageAttachment }) {
  const viewer = useViewerHost();
  const isImage = attachment.kind === 'image';
  return (
    <button
      type="button"
      onClick={() => viewer.open(toViewerTarget(attachment))}
      className="group flex max-w-44 min-w-0 items-center gap-2 rounded-lg border border-border bg-background/60 p-1.5 text-left transition-colors hover:bg-accent"
      title={attachment.name}
    >
      {isImage && (attachment.thumbnailUrl ?? attachment.url) ? (
        <img
          src={attachment.thumbnailUrl ?? attachment.url ?? ''}
          alt={attachment.name}
          className="size-9 shrink-0 rounded-md object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <FileText className="size-4 text-muted-foreground" strokeWidth={1.75} />
        </span>
      )}
      <span className="min-w-0 truncate text-xs">{attachment.name}</span>
    </button>
  );
}

function ResultMessage({ message }: { message: ChatMessage }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <MessageSquareQuote className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="line-clamp-2 min-w-0 wrap-anywhere">{message.text || '—'}</span>
    </p>
  );
}
