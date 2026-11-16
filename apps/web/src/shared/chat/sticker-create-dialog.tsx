// >320 строк — обоснование (I5): файл — форма жизни одного диалога (черновики
// файлов с превалидацией/пробой метаданных + инлайн-палитра + submit-цикл
// последовательной загрузки); разнос состояний размывал бы очистку
// objectURL-ов (draftsRef).
import { ImagePlus, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StickerPack } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@nodus/ui/components/button';
import { Checkbox } from '@nodus/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';

import { formatBytes } from '../lib/format.js';

import { EmojiPanel } from './emoji-picker.js';
import {
  useCanManageStickerPacks,
  useCreateStickerPack,
  stickerKeys,
  uploadStickerFile,
} from './sticker-api.js';
import { StickerGlyph } from './sticker-message.js';
import {
  STICKER_ACCEPT,
  isWebmFile,
  probeStickerMedia,
  validateStickerFile,
  type StickerIssue,
} from './sticker-upload-rules.js';

/**
 * Диалог создания пака стикеров и пополнения существующего (#143, модель
 * Битрикс24/Telegram): мультивыбор файлов → каждому 1–3 эмодзи (быстрая
 * палитра; датасет будущих подсказок) → название (при создании) → загрузка.
 * Превалидация формата/лимитов ДО трафика — sticker-upload-rules.ts;
 * сервер перепроверит magic bytes (Ф2).
 */

interface DraftSticker {
  key: string;
  file: File;
  previewUrl: string;
  width: number | null;
  height: number | null;
  isWebm: boolean;
  emojis: string[];
  issue: StickerIssue | null;
}

export function StickerCreateDialog({
  open,
  onOpenChange,
  /** Пополнение существующего пака (вместо создания нового). */
  appendTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appendTo?: StickerPack | null;
}) {
  const canManage = useCanManageStickerPacks();
  const create = useCreateStickerPack();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<DraftSticker[]>([]);
  const [title, setTitle] = useState('');
  const [corporate, setCorporate] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Созданный при первом submit набор (#866, AUD-030): повтор после сбоя
   *  продолжает его, а не создаёт второй пак. */
  const [createdPackId, setCreatedPackId] = useState<string | null>(null);
  /** Ключи уже загруженных стикеров: повтор догружает только незагруженные. */
  const [uploadedKeys, setUploadedKeys] = useState<ReadonlySet<string>>(new Set());
  /** Ключ черновика с открытой палитрой эмодзи (инлайн-палитра одна). */
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Реф текущих черновиков: cleanup objectURL-ов при закрытии без пересборки
  // эффекта на каждый ввод.
  const draftsRef = useRef<DraftSticker[]>([]);
  draftsRef.current = drafts;

  // objectURL-ы протекать не должны: чистим при закрытии (и сбрасываем форму).
  useEffect(() => {
    if (open) return;
    for (const d of draftsRef.current) URL.revokeObjectURL(d.previewUrl);
    setDrafts([]);
    setTitle('');
    setCorporate(false);
    setBusy(false);
    setCreatedPackId(null);
    setUploadedKeys(new Set());
    setPickingKey(null);
  }, [open]);

  async function addFiles(files: File[]) {
    const next: DraftSticker[] = [];
    for (const file of files) {
      const isWebm = isWebmFile(file);
      const previewUrl = URL.createObjectURL(file);
      const issue = validateStickerFile(file);
      const probe =
        issue === 'size'
          ? { width: null, height: null, durationIssue: false }
          : await probeStickerMedia(file, isWebm);
      next.push({
        key: `${file.name}:${file.size}:${crypto.randomUUID()}`,
        file,
        previewUrl,
        width: probe.width,
        height: probe.height,
        isWebm,
        emojis: [],
        issue: probe.durationIssue ? 'duration' : issue,
      });
    }
    setDrafts((prev) => [...prev, ...next]);
  }

  function toggleEmoji(key: string, emoji: string) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.key !== key) return d;
        const has = d.emojis.includes(emoji);
        if (has) return { ...d, emojis: d.emojis.filter((e) => e !== emoji) };
        if (d.emojis.length >= 3) return d;
        return { ...d, emojis: [...d.emojis, emoji] };
      }),
    );
  }

  function removeDraft(key: string) {
    setDrafts((prev) => {
      const target = prev.find((d) => d.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((d) => d.key !== key);
    });
  }

  const allValid =
    drafts.length > 0 && drafts.every((d) => d.issue === null && d.emojis.length > 0);
  const canSubmit = allValid && (appendTo ? true : title.trim().length > 0) && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      let packId = appendTo?.id ?? createdPackId;
      if (!packId) {
        const pack = await create.mutateAsync({
          title: title.trim(),
          scope: corporate ? 'corporate' : 'personal',
        });
        packId = pack.id;
        setCreatedPackId(pack.id);
        toast.success(ui.chat.stickerPackCreated);
      }
      // Повтор после сбоя продолжает набор: уже загруженные стикеры пропускаем,
      // новый набор не создаём (#866, AUD-030).
      const uploaded = new Set(uploadedKeys);
      for (const d of drafts) {
        if (uploaded.has(d.key)) continue;
        await uploadStickerFile(packId, {
          file: d.file,
          emojis: d.emojis,
          previewUrl: d.previewUrl,
          width: d.width,
          height: d.height,
        });
        uploaded.add(d.key);
        setUploadedKeys(new Set(uploaded));
      }
      await queryClient.invalidateQueries({ queryKey: stickerKeys.packs() });
      onOpenChange(false);
    } catch {
      toast.error(ui.chat.uploadFailed);
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-lg"
        /* Клик снаружи НЕ закрывает (вердикт владельца 30.09, канон #148/#149
           для окон с пополняемыми данными): случайный мимо-клик не может
           снести выбранные файлы, эмодзи и название. Отмена — намеренная:
           кнопка «Отмена» или Esc. */
        onInteractOutside={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>
            {appendTo
              ? `${ui.chat.stickerAddToPack}: ${appendTo.title}`
              : ui.chat.stickerCreatePack}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {appendTo ? null : (
            <>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={ui.chat.stickerPackTitlePlaceholder}
                maxLength={64}
                aria-label={ui.chat.stickerPackTitle}
              />
              {canManage ? (
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <Checkbox
                    checked={corporate}
                    onCheckedChange={(v) => setCorporate(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    {ui.chat.stickerCorporatePack}
                    <span className="block text-xs text-muted-foreground">
                      {corporate ? ui.chat.stickerCorporateHint : ui.chat.stickerPersonalHint}
                    </span>
                  </span>
                </label>
              ) : null}
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={STICKER_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus className="size-4" strokeWidth={1.75} />
            {ui.chat.stickerPickFiles}
          </Button>
          <p className="text-xs text-muted-foreground">{ui.chat.stickerEmptyHint}</p>
          {drafts.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {ui.chat.stickerEmojiStep} · {ui.chat.stickerEmojiHint}
                </p>
                {drafts.map((d) => (
                  <DraftRow
                    key={d.key}
                    draft={d}
                    picking={pickingKey === d.key}
                    onTogglePick={(key) => setPickingKey((prev) => (prev === key ? null : key))}
                    onToggle={toggleEmoji}
                    onRemove={(key) => {
                      removeDraft(key);
                      setPickingKey((prev) => (prev === key ? null : prev));
                    }}
                  />
                ))}
                {drafts.some((d) => d.issue === null && d.emojis.length === 0) ? (
                  <p className="text-label-xs text-muted-foreground">
                    {ui.chat.stickerEmojiMissing}
                  </p>
                ) : null}
              </div>
              {/* Палитра ИНЛАЙН в диалоге (ревизия 30.09: поповер внутри
                  диалога не скроллился колёсиком и рождал гориз. скролл),
                  на всю ширину окна — скролл только вертикальный. */}
              {pickingKey !== null ? (
                <div className="h-64 shrink-0 overflow-hidden rounded-lg border border-border">
                  <EmojiPanel
                    onPick={(emoji) => toggleEmoji(pickingKey, emoji)}
                    action={
                      <button
                        type="button"
                        aria-label={ui.chat.stickerEmojiPaletteClose}
                        title={ui.chat.stickerEmojiPaletteClose}
                        onClick={() => setPickingKey(null)}
                        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="size-4" strokeWidth={1.75} />
                      </button>
                    }
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter className="shrink-0 sm:items-center">
          <Button
            type="button"
            variant="ghost"
            size="default"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {ui.common.cancel}
          </Button>
          <Button type="button" size="default" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? ui.chat.emojiLoading : ui.chat.stickerUpload}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function issueText(issue: StickerIssue): string {
  if (issue === 'format') return ui.chat.stickerBadFormat;
  if (issue === 'size') return ui.chat.stickerTooLarge;
  return ui.chat.stickerTooLong;
}

/** Строка файла: превью + имя + выбранные эмодзи чипами + «выбрать» через
 *  ПОЛНЫЙ пикер эмодзи (EmojiPanel — тот же, что в композере; вердикт
 *  владельца 30.09: короткая палитра не годится). */
function DraftRow({
  draft,
  picking,
  onTogglePick,
  onToggle,
  onRemove,
}: {
  draft: DraftSticker;
  /** Палитра открыта для этой строки (инлайн-панель внизу диалога). */
  picking: boolean;
  onTogglePick: (key: string) => void;
  onToggle: (key: string, emoji: string) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-accent/40 p-2">
      <StickerGlyph
        url={draft.previewUrl}
        mime={draft.isWebm ? 'video/webm' : draft.file.type}
        className="size-12 shrink-0 rounded-md object-contain"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-xs">{draft.file.name}</span>
          <span className="ml-auto shrink-0 font-mono text-label-xs text-muted-foreground">
            {formatBytes(draft.file.size)}
          </span>
          <button
            type="button"
            aria-label={ui.chat.uploadRemove}
            onClick={() => onRemove(draft.key)}
            className="cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </span>
        {draft.issue !== null ? (
          <span className="text-label-xs text-destructive">{issueText(draft.issue)}</span>
        ) : (
          <span
            className="flex flex-wrap items-center gap-1"
            role="group"
            aria-label={ui.chat.stickerEmojiStep}
          >
            {draft.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`${emoji} — ${ui.common.cancel}`}
                title={ui.common.cancel}
                onClick={() => onToggle(draft.key, emoji)}
                className="flex size-6 cursor-pointer items-center justify-center rounded-md bg-accent text-sm ring-1 ring-info/50"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              aria-label={ui.chat.stickerAddEmoji}
              title={ui.chat.stickerAddEmoji}
              aria-pressed={picking}
              onClick={() => onTogglePick(draft.key)}
              className={cn(
                'flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-accent/50 hover:text-foreground',
                picking ? 'bg-accent text-foreground' : 'text-muted-foreground',
              )}
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
