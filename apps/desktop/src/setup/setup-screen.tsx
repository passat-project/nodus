import { useEffect, useState } from 'react';
import { SHELL_PANEL_HEIGHT, ui } from '@nodus/contracts';

import { ShellPanel } from '../shell/shell-panel.js';
import { shellApi, type ConnectionState, type UpdateOutcome } from '../shell/shell-ipc.js';

const t = ui.desktop;

/**
 * Экран «Адрес портала» (модель Битрикса) + производные состояния подключения:
 * офлайн-заглушка с повтором и экран «обновите приложение» (minShellVersion).
 * Живёт в главном окне до навигации на портал; после «Сменить сервер» из трея
 * оболочка возвращается сюда же. Сверху — панель безрамочного окна (ADR-0055):
 * кнопки окна и «Приложение» до подключения к порталу.
 */
export function SetupScreen() {
  const [state, setState] = useState<ConnectionState>({ status: 'idle' });
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateOutcome | null>(null);

  useEffect(() => {
    void shellApi.getState().then((initial) => {
      setState(initial);
      // Автоподключение по сохранённому/зашитому адресу: старт Windows,
      // перезапуск после обновления — сотрудник ничего не вводит (ADR-0019).
      if (initial.status === 'idle' && initial.savedAddress) {
        void retry();
      }
    });
  }, []);

  const busy = state.status === 'connecting' || update?.status === 'installing';

  async function connect() {
    setError(null);
    setState({ status: 'connecting' });
    try {
      setState(await shellApi.connect(address));
    } catch (e) {
      // Rust возвращает коды ('invalid_address') — строку показывает UI (I15).
      setError(e === 'invalid_address' ? t.invalidAddress : String(e));
      setState({ status: 'idle' });
    }
  }

  async function retry() {
    setState({ status: 'connecting' });
    setState(await shellApi.retry().catch(() => ({ status: 'idle' as const })));
  }

  async function runUpdater() {
    setUpdate({ status: 'installing' });
    setUpdate(await shellApi.runUpdater().catch(() => ({ status: 'unavailable' as const })));
  }

  return (
    <div
      className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-6 font-sans"
      style={{ paddingTop: SHELL_PANEL_HEIGHT }}
    >
      <ShellPanel />
      <ThemeToggle />
      {state.status === 'needs-update' ? (
        <section className="bg-card w-full max-w-md rounded-[14px] border p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{t.updateRequiredTitle}</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            {t.updateRequiredHint}
          </p>
          {update?.status === 'unavailable' ? (
            <p className="text-warning mt-3 text-sm">{t.updateUnavailable}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void runUpdater()}
            disabled={busy}
            className="bg-primary text-primary-foreground mt-5 h-9 rounded-[10px] px-4 text-sm font-medium disabled:opacity-60"
          >
            {busy ? t.connecting : t.updateNow}
          </button>
        </section>
      ) : state.status === 'offline' ? (
        <section className="bg-card w-full max-w-md rounded-[14px] border p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{t.offlineTitle}</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{t.offlineHint}</p>
          <p className="text-muted-foreground mt-1 truncate text-xs">{state.address}</p>
          <button
            type="button"
            onClick={() => void retry()}
            className="bg-primary text-primary-foreground mt-5 h-9 rounded-[10px] px-4 text-sm font-medium"
          >
            {t.retry}
          </button>
        </section>
      ) : (
        <section className="bg-card w-full max-w-md rounded-[14px] border p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{t.connectTitle}</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{t.connectHint}</p>
          <label className="mt-5 block text-sm font-medium" htmlFor="portal-address">
            {t.addressLabel}
          </label>
          <input
            id="portal-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void connect();
            }}
            placeholder={t.addressPlaceholder}
            autoFocus
            spellCheck={false}
            className="border-input bg-background focus:ring-ring mt-1.5 h-10 w-full rounded-[10px] border px-3 text-sm outline-none focus:ring-2"
          />
          {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
          {address.trim().toLowerCase().startsWith('http://') ? (
            <p className="text-warning mt-2 text-sm leading-snug">{t.insecureWarning}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy || address.trim().length === 0}
            className="bg-primary text-primary-foreground mt-5 h-9 rounded-[10px] px-4 text-sm font-medium disabled:opacity-60"
          >
            {busy ? t.connecting : t.connect}
          </button>
        </section>
      )}
    </div>
  );
}

/** Переключатель тёмной темы экрана подключения (persist до первой отрисовки).
 *  Под панелью окна (ADR-0055): верхнюю полосу строки занимает панель. */
function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem('nodus-shell-theme-v1', dark ? 'dark' : 'light');
    } catch {
      /* приватный режим — просто без персиста */
    }
  }, [dark]);
  return (
    <button
      type="button"
      aria-label={t.themeToggle}
      onClick={() => setDark((v) => !v)}
      className="text-muted-foreground hover:text-foreground absolute right-4 top-[56px] h-9 w-9 rounded-[10px] text-sm"
    >
      {dark ? '☀' : '☾'}
    </button>
  );
}
