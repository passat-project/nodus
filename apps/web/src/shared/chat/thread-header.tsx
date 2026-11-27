import { ArrowLeft, Eye, EyeOff, X } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Шапка окна треда (#42): моно-метка «Обсуждение» с числом ответов, метка
 * чужой печати, справа — «Следить/Перестать» (раунд 3: уведомления и счётчик
 * трэда — только наблюдателям; кнопка / реплай / @ / автор поста) и крестик
 * «Закрыть» у ПРАВОГО КРАЯ колонки (закон колонки, как у панели «О чате»;
 * вердикт 25.11.2026, #1061): выход виден, даже если полоса поста ушла из
 * вида. В 'drill' (тред заменил ленту) крестика нет — только «К ленте»
 * (решение 24.11.2026, #1021).
 */
export function ThreadHeader({
  variant,
  barClass,
  replyCount,
  typingLabel,
  watched,
  watchPending,
  onToggleWatch,
  onClose,
}: {
  variant: 'drill' | 'side';
  /** Высота бара треда = высота бара хоста (линии border-b продолжаются
   *  друг в друга — канон панели беседы, `headerClass`). */
  barClass: string;
  replyCount: number;
  typingLabel: string | null;
  watched: boolean;
  watchPending: boolean;
  onToggleWatch: () => void;
  onClose: () => void;
}) {
  return (
    <header
      className={cn('flex shrink-0 items-center gap-2 border-b border-border px-3', barClass)}
    >
      {variant === 'drill' ? (
        <Button variant="ghost" size="icon" aria-label={ui.chat.backToFeed} onClick={onClose}>
          <ArrowLeft />
        </Button>
      ) : null}
      <NodeLabel label={ui.chat.discussion} count={replyCount} />
      {typingLabel ? (
        <span className="min-w-0 truncate text-xs italic text-info">{typingLabel}</span>
      ) : null}
      <span className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-muted-foreground"
          aria-label={watched ? ui.chat.unwatchThread : ui.chat.watchThread}
          title={watched ? ui.chat.unwatchThread : ui.chat.watchThread}
          disabled={watchPending}
          onClick={onToggleWatch}
        >
          {watched ? (
            <EyeOff className="size-4" strokeWidth={1.75} />
          ) : (
            <Eye className="size-4" strokeWidth={1.75} />
          )}
          <span className="text-xs">{watched ? ui.chat.unwatchThread : ui.chat.watchThread}</span>
        </Button>
        {variant === 'side' ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={ui.common.close}
            title={ui.common.close}
            onClick={onClose}
          >
            <X />
          </Button>
        ) : null}
      </span>
    </header>
  );
}
