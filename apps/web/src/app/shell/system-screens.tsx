import { Link } from '@tanstack/react-router';
import { Button } from '@nodus/ui/components/button';
import { ui } from '@nodus/contracts';

import { useRemoveBootSplash } from '../boot-splash.js';

/**
 * Системные экраны роутера (аудит #45: голые «Not Found»/«Something went
 * wrong!» на английском, тупик без выхода): единый узел-стиль, русский текст
 * из i18n (I15), выход на главную. Ошибка в консоль — для диагностики;
 * пользователю — без технического текста.
 */
function SystemScreen({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  // Экран заменяет корневую рамку — стартовую заставку снимать некому, кроме него.
  useRemoveBootSplash();
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold text-balance text-foreground">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function RouterErrorScreen({ error }: { error: unknown }) {
  // Техподробности — в консоль (traceId/correlation), не на экран (вердикт #45).
  console.error('[router]', error);
  return (
    <SystemScreen title={ui.common.errorTitle} description={ui.common.errorDescription}>
      <Button onClick={() => window.location.reload()}>{ui.common.reload}</Button>
      <Button variant="outline" asChild>
        <Link to="/">{ui.common.backHome}</Link>
      </Button>
    </SystemScreen>
  );
}

export function NotFoundScreen() {
  return (
    <SystemScreen title={ui.common.notFoundTitle} description={ui.common.notFoundDescription}>
      <Button asChild>
        <Link to="/">{ui.common.backHome}</Link>
      </Button>
    </SystemScreen>
  );
}
