import { Copy, FolderOpen, Info, SquareArrowOutUpRight, type LucideIcon } from 'lucide-react';
import { isPathOnFileServer, isRevealOnlyUncPath, parseUncPath, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import {
  desktopOpenUncPath,
  desktopPathCommandsAvailable,
  desktopRevealUncPath,
  isDesktopShell,
} from '../desktop/desktop-bridge.js';
import { useFileServersStore } from '../desktop/file-servers-store.js';

/** Путь как пара «имя файла + папка»: в узкой колонке карточки ценны оба
 *  (файл узнают по имени, сервер — по началу пути), а одной строкой обрезка
 *  съедала и то, и другое. Значение не меняется: полный путь остаётся в
 *  `title`, копировании и командах моста. */
export function splitPathValue(path: string): { dir: string | null; name: string } {
  const index = path.lastIndexOf('\\');
  if (index <= 0 || index === path.length - 1) return { dir: null, name: path };
  return { dir: path.slice(0, index), name: path.slice(index + 1) };
}

/** Текст пути: одна строка (таблицы, триггеры форм) или две (карточка). */
export function PathText({ path, stacked = false }: { path: string; stacked?: boolean }) {
  const { dir, name } = splitPathValue(path);
  if (!stacked || dir === null) {
    return (
      <span className="truncate font-mono text-[13px]" title={path}>
        {path}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col gap-0.5 py-0.5" title={path}>
      <span className="truncate font-mono text-[13px] text-foreground">{name}</span>
      <span className="truncate font-mono text-[11px] text-muted-foreground">{dir}</span>
    </span>
  );
}

function CopyPathButton({ path, visible = false }: { path: string; visible?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={ui.customFields.value.copyPath}
      title={ui.customFields.value.copyPath}
      onClick={() => {
        void navigator.clipboard.writeText(path).then(
          () => toast.success(ui.customFields.value.pathCopied),
          () => toast.error(ui.common.copyError),
        );
      }}
      className={cn(
        'text-muted-foreground',
        !visible && 'opacity-0 group-hover/field:opacity-100 focus-visible:opacity-100',
      )}
    >
      <Copy className="size-3.5" strokeWidth={1.75} />
    </Button>
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
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-muted-foreground"
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
    </Button>
  );
}

/** Подсказка, почему у пути нет действий (браузер/старая оболочка/чужой сервер). */
function PathHint({ text }: { text: string }) {
  return (
    <span role="img" aria-label={text} title={text} className="shrink-0 p-1 text-muted-foreground">
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
 * РЯДОМ с триггером правки, а не кнопкой в кнопке. `hint="text"` — подсказка
 * видимой строкой под значением (карточка: сетка `minmax(0,1fr)_auto`,
 * подсказка `col-span-full`): иконка ⓘ без наведения не читалась, а в
 * браузере это единственное объяснение, почему файл не открывается.
 */
export function PathValueActions({
  path,
  hint = 'icon',
}: {
  path: string;
  hint?: 'icon' | 'text';
}) {
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

  const hintText = !shell
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
    <>
      <span className="flex shrink-0 items-center gap-0.5">
        {commands && allowed && !revealOnly ? (
          <PathActionButton
            icon={SquareArrowOutUpRight}
            label={ui.customFields.value.openPath}
            onClick={() => void open()}
          />
        ) : null}
        {commands && allowed ? (
          <PathActionButton
            icon={FolderOpen}
            label={ui.customFields.value.revealPath}
            onClick={() => void reveal()}
          />
        ) : null}
        <CopyPathButton path={path} visible={!shell || !commands || (loaded && !allowed)} />
        {hintText && hint === 'icon' ? <PathHint text={hintText} /> : null}
      </span>
      {hintText && hint === 'text' ? (
        <span className="col-span-full basis-full text-xs text-muted-foreground">{hintText}</span>
      ) : null}
    </>
  );
}

/** Значение-путь целиком: моно-текст + действия (#558, Р11). */
export function PathValue({ path }: { path: string }) {
  return (
    <span className="group/field inline-flex min-w-0 max-w-full items-center gap-1">
      <PathText path={path} />
      <PathValueActions path={path} />
    </span>
  );
}
