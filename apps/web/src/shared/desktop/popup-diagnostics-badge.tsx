import { useState, useSyncExternalStore } from 'react';
import { ui } from '@nodus/contracts';

import { wsDebugEnabled } from '../socket/ws-debug.js';
import {
  clearPopupDecisions,
  getPopupDecisions,
  subscribePopupDecisions,
  type PopupDecision,
} from './popup-diagnostics.js';

/**
 * Панель диагностики попапов (#811, только `?wsdebug=1`): владелец после
 * редкого «попап не пришёл» открывает журнал и видит всю цепочку — событие
 * дошло, какой гейт решил, запрошен ли попап, приняла ли его оболочка.
 * Не продуктовый элемент: за флагом, компактный, без новых примитивов.
 */
export function PopupDebugBadge() {
  if (!wsDebugEnabled) return null;
  return <PopupDebugPanel />;
}

/** Панель журнала (экспорт — тесты; в продукте монтируется под флагом). */
export function PopupDebugPanel() {
  const [open, setOpen] = useState(false);
  const decisions = useSyncExternalStore(subscribePopupDecisions, getPopupDecisions, () => []);
  if (!open) {
    return (
      <button
        type="button"
        data-slot="popup-debug-badge"
        title={ui.wsDebug.popupBadgeHint}
        onClick={() => setOpen(true)}
        className="fixed bottom-2 left-7 z-[80] cursor-pointer rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground shadow-sm hover:text-foreground"
      >
        {ui.wsDebug.popupBadge}
        {decisions.length > 0 ? ` · ${decisions.length}` : ''}
      </button>
    );
  }
  return (
    <div
      data-slot="popup-debug-panel"
      className="fixed bottom-2 left-2 z-[80] flex max-h-[55vh] w-[420px] flex-col overflow-hidden rounded-lg border border-border bg-card text-xs shadow-lg"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate font-medium">{ui.wsDebug.popupTitle}</span>
        <button
          type="button"
          onClick={clearPopupDecisions}
          className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground"
        >
          {ui.wsDebug.popupClear}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
      <p className="shrink-0 px-2 py-1 text-[10px] leading-snug text-muted-foreground">
        {ui.wsDebug.popupHint}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 font-mono text-[11px]">
        {decisions.length === 0 ? (
          <p className="py-2 font-sans text-muted-foreground">{ui.wsDebug.popupEmpty}</p>
        ) : (
          [...decisions]
            .reverse()
            .map((decision, index) => (
              <PopupRow key={`${decision.ts}-${index}`} decision={decision} />
            ))
        )}
      </div>
    </div>
  );
}

function PopupRow({ decision }: { decision: PopupDecision }) {
  const time = new Date(decision.ts).toLocaleTimeString('ru-RU', { hour12: false });
  return (
    <div className="flex items-baseline gap-1.5 border-b border-border/40 py-0.5 last:border-0">
      <span className="shrink-0 text-muted-foreground tabular-nums">{time}</span>
      <span className="shrink-0 font-sans text-foreground">
        {ui.wsDebug.popupReason[decision.reason]}
      </span>
      {decision.detail ? (
        <span className="shrink-0 text-muted-foreground">· {decision.detail}</span>
      ) : null}
      {decision.conversationId ? (
        <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
          {decision.conversationId.slice(0, 8)}
        </span>
      ) : null}
    </div>
  );
}
