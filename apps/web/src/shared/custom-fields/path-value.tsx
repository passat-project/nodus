import { Copy, FolderOpen, FolderSearch, Info } from 'lucide-react';
import { isPathOnFileServer, isRevealOnlyUncPath, parseUncPath, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import {
  desktopOpenUncPath,
  desktopPathCommandsAvailable,
  desktopRevealUncPath,
  isDesktopShell,
} from '../desktop/desktop-bridge.js';
import { useFileServersStore } from '../desktop/file-servers-store.js';

function CopyPathButton({ path, visible = false }: { path: string; visible?: boolean }) {
  return (
    <button
      type="button"
      aria-label={ui.customFields.value.copyPath}
      title={ui.customFields.value.copyPath}
      onClick={() => {
        void navigator.clipboard.writeText(path).then(
          () => toast.success(ui.customFields.value.pathCopied),
          () => toast.error(ui.common.copyError),
        );
      }}
      className={cn(
        'rounded p-1 text-muted-foreground transition-opacity focus-visible:opacity-100 hover:text-foreground',
        visible ? 'opacity-100' : 'opacity-0 group-hover/field:opacity-100',
      )}
    >
      <Copy className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

/** Текст отказа моста — понятный человеку (#558). */
function pathErrorText(code: string, fallback: 'open' | 'reveal'): string {
  switch (code) {
    case 'not_found':
      return ui.customFields.value.pathNotFound;
    case 'server_not_allowed':
      return ui.customFields.value.pathServerNotAllowed;
    case 'invalid_path':
    case 'path_not_allowed':
      return ui.customFields.value.pathInvalid;
    case 'path_unavailable':
      return ui.customFields.value.pathUnavailable;
    case 'reveal_only':
      return ui.customFields.value.pathRevealOnly;
    default:
      return fallback === 'open'
        ? ui.customFields.value.pathOpenFailed
        : ui.customFields.value.pathRevealFailed;
  }
}

function PathActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FolderOpen;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground transition-opacity focus-visible:opacity-100 hover:text-foreground"
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

/** Подсказка, почему у пути нет действий (браузер/старая оболочка/чужой сервер). */
function PathHint({ text }: { text: string }) {
  return (
    <span role="img" aria-label={text} title={text} className="p-1 text-muted-foreground/60">
      <Info className="size-3.5" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/**
 * Действия у значения-пути (#558, Р11): в оболочке с командами и
 * разрешённым сервером — «Открыть» и «Показать в папке»; в браузере, старой
 * оболочке и у чужого сервера — «Скопировать путь» и подсказка. Исполняемые
 * файлы и ярлыки открывать нельзя — только «Показать в папке» (решает и Rust).
 *
 * Отдельный компонент — чтобы редактор ссылки в карточке ставил действия
 * РЯДОМ с триггером правки, а не кнопкой в кнопке.
 */
export function PathValueActions({ path }: { path: string }) {
  const shell = isDesktopShell();
  const commands = desktopPathCommandsAvailable();
  const servers = useFileServersStore((s) => s.servers);
  const loaded = useFileServersStore((s) => s.loaded);
  const allowed = loaded && isPathOnFileServer(path, servers);
  const valid = parseUncPath(path) !== null;
  const revealOnly = isRevealOnlyUncPath(path);

  const reveal = async () => {
    const result = await desktopRevealUncPath(path, servers);
    if (result.status === 'error') toast.error(pathErrorText(result.code, 'reveal'));
  };

  const open = async () => {
    const result = await desktopOpenUncPath(path, servers);
    if (result.status === 'error') {
      if (result.code === 'reveal_only') {
        toast.info(ui.customFields.value.pathRevealOnly);
        await reveal();
        return;
      }
      toast.error(pathErrorText(result.code, 'open'));
    }
  };

  const hint = !shell
    ? ui.customFields.value.openInAppHint
    : !commands
      ? ui.customFields.value.updateAppHint
      : !valid
        ? ui.customFields.value.pathInvalid
        : loaded && !allowed
          ? ui.customFields.value.serverNotAllowedHint
          : revealOnly
            ? ui.customFields.value.pathRevealOnly
            : null;

  return (
    <span className="flex shrink-0 items-center">
      {commands && allowed && !revealOnly ? (
        <PathActionButton
          icon={FolderOpen}
          label={ui.customFields.value.openPath}
          onClick={() => void open()}
        />
      ) : null}
      {commands && allowed ? (
        <PathActionButton
          icon={FolderSearch}
          label={ui.customFields.value.revealPath}
          onClick={() => void reveal()}
        />
      ) : null}
      <CopyPathButton path={path} visible={!shell || !commands || (loaded && !allowed)} />
      {hint ? <PathHint text={hint} /> : null}
    </span>
  );
}

/** Значение-путь целиком: моно-текст + действия (#558, Р11). */
export function PathValue({ path }: { path: string }) {
  return (
    <span className="group/field inline-flex min-w-0 max-w-full items-center gap-1">
      <span className="truncate font-mono text-[13px]" title={path}>
        {path}
      </span>
      <PathValueActions path={path} />
    </span>
  );
}
