import type { ReactNode } from 'react';

/**
 * Шапка вкладки-списка карточки (#736): тот же слой, что у главных окон
 * модулей (`h-14`, горизонтальные поля `px-6`, зазор `gap-3`). Строка
 * инструментов внутри — `ListToolbar` с `px-0`: отступы даёт шапка, а не
 * тулбар, иначе кнопка создания и поиск липнут к полосе вкладок.
 */
export function CardTabToolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-14 shrink-0 items-center gap-3 px-6">{children}</div>;
}
