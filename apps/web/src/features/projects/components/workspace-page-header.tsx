import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';

/**
 * Шапка страницы рабочей области типа проекта (#857): одна строка h-14 без
 * border-b (канон журналов) — «‹» к холсту, заголовок, счётчик и действия
 * справа. Страницы («Что здесь можно создавать», «Какие папки здесь
 * бывают») открываются на всю правую область, не в панели.
 */
export function WorkspacePageHeader({
  title,
  count,
  onBack,
  actions,
}: {
  title: string;
  count?: number;
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-3">
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 hover:bg-accent"
        onClick={onBack}
        aria-label={ui.common.back}
        title={ui.common.back}
      >
        <span aria-hidden className="text-lg leading-none">
          ‹
        </span>
      </Button>
      <NodeLabel label={title} count={count} className="min-w-0 truncate pl-1" />
      {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
    </header>
  );
}
