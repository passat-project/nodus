import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useViewerStore, type ViewerTarget } from './viewer-store.js';

/** Хост просмотра вложений: глобальная модалка приложения или встроенный
 *  хост карточки (вкладки правой зоны задачи). Открытие внутри карточки не
 *  должно всплывать модалкой поверх неё — контекст перехватывает клики
 *  вложений (карточки сообщений, витрина «О задаче», файлы результата).
 *  `embedded` — хост показал файл у себя: окно-список витрины закрывается. */
export interface ViewerHost {
  open: (target: ViewerTarget) => void;
  embedded: boolean;
}

const ViewerHostContext = createContext<ViewerHost | null>(null);

export function ViewerHostProvider({
  open,
  children,
}: {
  open: (target: ViewerTarget) => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ open, embedded: true }), [open]);
  return <ViewerHostContext.Provider value={value}>{children}</ViewerHostContext.Provider>;
}

/** Открыть вложение: встроенный хост карточки, иначе — общая модалка. */
export function useViewerHost(): ViewerHost {
  const host = useContext(ViewerHostContext);
  const openGlobal = useViewerStore((s) => s.open);
  return host ?? { open: openGlobal, embedded: false };
}
