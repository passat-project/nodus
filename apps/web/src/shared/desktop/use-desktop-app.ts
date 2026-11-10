import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DESKTOP_BRIDGE_EVENTS,
  shellUpdateStateSchema,
  type ShellUpdateState,
} from '@nodus/contracts';

import {
  getShellInfo,
  getShellUpdateState,
  isDesktopShell,
  onDesktopEvent,
} from './desktop-bridge.js';
import { fetchDesktopManifest, type DesktopManifest } from './desktop-manifest.js';

export const desktopAppKeys = {
  manifest: ['desktop', 'manifest'] as const,
};

const IDLE_STATE: ShellUpdateState = { status: 'idle', version: null };

/**
 * Кнопка «Скачать приложение» (#263): манифест раздачи `/desktop/latest.json`
 * (браузер и оболочка), в оболочке — ещё и состояние автообновления мостом
 * (событие update-state + первичный опрос). Нет манифеста — кнопки нет.
 */
export function useDesktopApp(): {
  manifest: DesktopManifest | null;
  inShell: boolean;
  updateState: ShellUpdateState;
  shellVersion: string | null;
} {
  const manifest = useQuery({
    queryKey: desktopAppKeys.manifest,
    queryFn: fetchDesktopManifest,
    // Манифест живёт редко и не горит: фоновых рефетчей нет — кнопка не
    // мигает на каждом фокусе окна. Один тихий повтор: первый фетч при
    // холодном старте оболочки спотыкался, и до ремоунта данных не было
    // (фидбек 09.10). Кнопка в оболочке от манифеста не зависит (рендерится
    // всегда) — повтор только для текстов попапа.
    staleTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const inShell = isDesktopShell();
  const [updateState, setUpdateState] = useState<ShellUpdateState>(IDLE_STATE);
  const manifestData = manifest.data;
  const refetchManifest = manifest.refetch;
  // Оболочка узнаёт о новой версии раньше, чем долгоживущий SPA перечитает
  // манифест (фетч один на загрузку страницы, фоновых рефетчей нет): попап
  // иначе показывает «1.0.15 → 1.0.15» и чужой текст «что нового» (#739).
  // Один рефетч на версию — без циклов; заметки догоняют целевую версию.
  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!inShell || updateState.status !== 'available' || !updateState.version) return;
    if (manifestData?.version === updateState.version) return;
    if (refreshedFor.current === updateState.version) return;
    refreshedFor.current = updateState.version;
    void refetchManifest();
  }, [inShell, updateState.status, updateState.version, manifestData?.version, refetchManifest]);
  // Установленная версия оболочки (мост): в попапе без обновлений показываем
  // ЕЁ, а не версию с сервера — «1.0.4 / Новых версий нет» сбивало с толку
  // (фидбек 09.10).
  const [shellVersion, setShellVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!inShell) return;
    void getShellInfo().then((info) => {
      if (info) setShellVersion(info.version);
    });
    const pull = () => {
      void getShellUpdateState().then((state) => {
        if (state) setUpdateState(state);
      });
    };
    pull();
    const unsubscribe = onDesktopEvent(
      DESKTOP_BRIDGE_EVENTS.updateState,
      shellUpdateStateSchema,
      setUpdateState,
    );
    // Пуш события теряется, если прилетает eval'ом раньше монтирования
    // слушателя (мост без очереди): дотягиваем состояние опросом — чинит и
    // уже выпущенные оболочки без репуша (фидбек 09.10: точка требовала
    // перезагрузки портала).
    const poll = window.setInterval(pull, 15_000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [inShell]);

  return {
    manifest: manifestData ?? null,
    inShell,
    updateState,
    shellVersion,
  };
}
