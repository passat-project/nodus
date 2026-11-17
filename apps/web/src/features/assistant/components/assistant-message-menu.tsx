import type { ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { ui, type ChatMessage } from '@nodus/contracts';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@nodus/ui/components/context-menu';

/**
 * Контекстные команды на пузырях ассистента — канон чатов (правый клик),
 * но без мессенджерных мутаций (пин/избранное/в задачу): здесь диалог с ИИ,
 * а не беседа. Минимум, который просил владелец (18.11.2026), — «Копировать»:
 * копирует исходный текст сообщения (для ответа — Markdown-исходник).
 */
export function AssistantMessageMenu({
  message,
  children,
}: {
  message: ChatMessage;
  children: ReactNode;
}) {
  function copy() {
    void navigator.clipboard
      .writeText(message.text)
      .then(() => toast.success(ui.chat.copied))
      .catch(() => toast.error(ui.common.copyError));
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={copy}>
          <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
          {ui.chat.menu.copy}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
