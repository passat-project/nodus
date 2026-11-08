import { FileText, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { EffectiveSection, MessageAttachment } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import { useMessagesLookup } from '../../../chat/message-lookup-api.js';
import { useSendChatMessage } from '../../../chat/send-message.js';
import { uploadAttachment } from '../../../chat/upload-attachment.js';
import { toViewerTarget } from '../../../chat/vault-list.js';
import { useViewerStore } from '../../../files/viewer-store.js';
import { ChatFilePicker } from '../chat-file-picker.js';
import { draftMessageIds, type WindowDraft } from '../use-window-draft.js';

/**
 * «Файлы итога» (#380): зона «Перетащите файл или выберите» + «Выбрать из
 * чата задачи». Загрузка — существующим потоком вложений чата: сообщение с
 * подписью раздела уходит в беседу задачи, его id — в итог. Отмена окна
 * сообщение не удаляет (файл задачи живёт в её чате, так в issue).
 */
export function ResultFilesSection({
  section,
  conversationId,
  draft,
  addFiles,
  toggleFile,
  disabled,
}: {
  section: Extract<EffectiveSection, { kind: 'result_files' }>;
  conversationId: string | null;
  draft: WindowDraft;
  addFiles: (messageIds: string[]) => void;
  toggleFile: (messageId: string) => void;
  disabled: boolean;
}) {
  const send = useSendChatMessage(conversationId ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const allIds = draftMessageIds(draft);
  const { data } = useMessagesLookup(conversationId, allIds, conversationId !== null);
  const attachments = (data?.items ?? []).flatMap((m) =>
    m.attachments.filter((a) => a.kind === 'image' || a.kind === 'file'),
  );
  const editable = !disabled && conversationId !== null;

  async function upload(files: FileList | File[]) {
    if (!conversationId || uploading) return;
    setUploading(true);
    try {
      const uploaded: MessageAttachment[] = [];
      for (const file of Array.from(files)) {
        const handle = uploadAttachment(file, () => {});
        uploaded.push(await handle.promise);
      }
      if (uploaded.length === 0) return;
      const message = await send.mutateAsync({
        text: section.label || ui.tasks.window.filesLabel,
        attachmentIds: uploaded.map((a) => a.id),
        attachments: uploaded,
      });
      addFiles([message.id]);
    } catch {
      toast.error(ui.chat.uploadFailed);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          if (editable) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!editable) return;
          e.preventDefault();
          void upload(e.dataTransfer.files);
        }}
        className={cn(
          'flex min-h-16 items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground',
          editable ? 'cursor-pointer hover:bg-accent/40' : 'opacity-60',
        )}
        onClick={() => editable && inputRef.current?.click()}
        role="button"
        tabIndex={editable ? 0 : -1}
        aria-label={ui.tasks.window.filesHint}
        onKeyDown={(e) => {
          if (editable && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click();
        }}
      >
        {uploading ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <Upload className="size-4" strokeWidth={1.75} />
        )}
        <span>{ui.tasks.window.filesHint}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {conversationId === null && !disabled ? (
        <p className="text-xs text-muted-foreground">{ui.tasks.window.noConversation}</p>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          disabled={!editable}
          onClick={() => setPickerOpen((open) => !open)}
        >
          {ui.tasks.window.chooseFromChat}
        </Button>
      )}
      {pickerOpen && conversationId !== null ? (
        <ChatFilePicker
          conversationId={conversationId}
          selected={draft.files}
          onToggle={toggleFile}
        />
      ) : null}
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => useViewerStore.getState().open(toViewerTarget(attachment))}
              className="flex max-w-44 min-w-0 items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent"
              title={attachment.name}
            >
              {attachment.kind === 'image' && (attachment.thumbnailUrl ?? attachment.url) ? (
                <img
                  src={attachment.thumbnailUrl ?? attachment.url ?? ''}
                  alt={attachment.name}
                  className="size-6 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              )}
              <span className="min-w-0 truncate">{attachment.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
