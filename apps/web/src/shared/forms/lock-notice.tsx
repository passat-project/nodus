import { Lock } from 'lucide-react';

/** Метка окна ввода (#496, Р4): поле закрепится после создания или после
 *  нажатия кнопки — сотрудник знает заранее, что потом руками не поменять. */
export function WillLockNotice({ text }: { text: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" title={text}>
      <Lock className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="max-w-48 truncate">{text}</span>
    </span>
  );
}
