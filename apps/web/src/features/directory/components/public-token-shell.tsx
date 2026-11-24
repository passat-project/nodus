import type { ReactNode } from 'react';

import { LogoIcon } from '../../../app/shell/logo-icon.js';

/** Публичный каркас страниц приглашения/сброса (#101): без рейки и карточек,
 *  как экран входа — гость ещё не в портале. */
export function PublicTokenShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="node-panel w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-2">
          <LogoIcon className="size-10 text-foreground" />
          <span className="font-mono text-label-sm tracking-[0.16em] text-muted-foreground uppercase">
            Nodus
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}
