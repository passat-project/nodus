use std::sync::Mutex;

/// Фаза подключения к порталу — источник истины экрана «Адрес портала».
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Phase {
    /// Адреса нет (первый запуск или после смены сервера).
    #[default]
    Idle,
    Connecting,
    /// Сервер не отвечает — офлайн-заглушка с повтором.
    Offline,
    /// Версия оболочки ниже minShellVersion сервера.
    NeedsUpdate,
    /// Портал подключён, главное окно навигировано на него.
    Ready,
}

/// Глобальное состояние оболочки. Mutex-внутренность: команды приходят из
/// разных потоков (IPC портала, IPC мини-UI, меню трея); лок не держится
/// через await (канон асинхронных команд).
#[derive(Default)]
pub struct ShellState {
    pub inner: Mutex<ShellInner>,
}

#[derive(Default)]
pub struct ShellInner {
    pub phase: Phase,
    /// Нормализованный origin портала (`https://host[:port]`): цель навигации,
    /// источник updater-эндпоинта и эталон для гварда навигации.
    pub portal_root: Option<String>,
    pub server_name: Option<String>,
    pub min_shell_version: Option<String>,
    /// Deep link, пришедший до готовности портала (холодный старт/офлайн):
    /// доставляется в веб-приложение по сигналу `shell_ready`.
    pub pending_deep_link: Option<String>,
    /// Последнее отправленное порталу состояние фокуса главного окна
    /// (`shell-focus`, #770): дедуп событий Focused/Resized — окно шлёт их
    /// сериями, а модель внимания хочет только переходы.
    pub shell_focused: Option<bool>,
}
