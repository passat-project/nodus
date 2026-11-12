//! Клавиатурный фокус попапов — второй слой (#709).
//!
//! Первый слой — неактивируемость: `.focusable(false)` даёт
//! `WS_EX_NOACTIVATE`, и tao держит бит сам. Но стиль запрещает только
//! ПОЛЬЗОВАТЕЛЬСКУЮ активацию (клик, `ShowWindow`): программно окно
//! активируется (Raymond Chen, «My window has WS_EX_NOACTIVATE, but it got
//! activated anyway», 19.09.2024), а `SetFocus` по документации MS «activates
//! either the window that receives the focus or the parent of the window that
//! receives the focus».
//!
//! WebView2 живёт в отдельном процессе (`msedgewebview2.exe`): его
//! `Chrome_WidgetWin_1` — кросс-процессный ребёнок контейнера попапа, и фокус
//! он забирает сам (WebView2Feedback #2487; winit #4345 «webview child pulls
//! focus … parent remains foreground»; unoplatform/uno #23481 «spurious
//! Deactivated raised when the WebView2 renderer HWND gains focus»).
//!
//! Измерено на живой оболочке (#709, проба снаружи по кадрам 250 мс):
//!
//! ```text
//! до показа : fg=main  active=main  focus=Chrome_WidgetWin_1  root=main
//! показ     : fg=попап active=попап focus=Chrome_WidgetWin_1  root=попап (360x93)
//! после     : fg=…     active=0     focus=0                  root=0
//! ```
//!
//! То есть показ попапа **может сделать его foreground** (поэтому одного
//! `GetForegroundWindow()` недостаточно и он врёт в обе стороны), а
//! уничтожение окна с webview-ребёнком часто оставляет очередь ввода вообще
//! без фокуса (winit #4345) — каретка не возвращается сама, только кликом.
//! Правда о клавиатуре живёт в `GetGUIThreadInfo().hwndFocus`.
//!
//! Ремонт — `SetFocus` в нужное окно: `tao::set_focus()` бесполезен, он no-op,
//! когда окно уже foreground (tao-0.37.1 `window.rs:139-150`), а wry на
//! `WM_SETFOCUS` родителя сам зовёт `MoveFocus(PROGRAMMATIC)` в его webview
//! (`wry-0.57.0/src/webview2/mod.rs:1325-1328`; сабкласс ставится при
//! `!is_child`, т.е. в дефолтной сборке Tauri без фичи `unstable`) — Chromium
//! возвращает каретку в поле, не терявшее DOM-фокус.
//!
//! `SetFocus` вызывается ТОЛЬКО с главного потока: «the window must be attached
//! to the calling thread's message queue» — с фонового потока вернётся ошибка
//! (та же ловушка, что у проверки ex-style в `show_without_activation`, #709).

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId,
    SetForegroundWindow, GA_ROOT, GUITHREADINFO,
};

use crate::activity;
use crate::popups;

/// Возвратов фокуса за окно: защита от гонки. Наивный app-side ремонт фокуса
/// в tauri#15624 давал петли 140–200 Гц — при превышении лимита возврат
/// прекращается с `error` в лог (сигнал: нужен другой механизм).
const MAX_RECLAIMS: u32 = 8;
const RECLAIM_WINDOW_MS: u64 = 3_000;
/// Сторож после создания/показа: 40 мс × 50 = 2 с. Кража фокуса приходит
/// асинхронно (создание контроллера WebView2, первый composite, навигация
/// мини-UI), поэтому одной проверки в момент `show()` недостаточно — именно
/// на этом и провалился #709.
const GUARD_TICK_MS: u64 = 40;
const GUARD_TICKS: u32 = 50;

static RECLAIM_COUNT: AtomicU32 = AtomicU32::new(0);
static RECLAIM_START_MS: AtomicU64 = AtomicU64::new(0);
static LIMIT_LOGGED: AtomicBool = AtomicBool::new(false);

/// Снимок фокуса потока главного окна. `focus_root` — top-level предок окна с
/// клавиатурой (`GetAncestor(GA_ROOT)`), т.е. «чей это попап/портал».
#[derive(Debug, Clone)]
pub(crate) struct FocusSnapshot {
    pub(crate) foreground: isize,
    pub(crate) active: isize,
    pub(crate) focus: isize,
    pub(crate) focus_root: isize,
    pub(crate) focus_class: String,
}

impl FocusSnapshot {
    /// Строка для лога. Диагностика обязательна: три прошлых захода не
    /// оставили ни одной записи о фокусе, и разбор снова был бы догадкой.
    pub(crate) fn log_line(&self) -> String {
        format!(
            "fg=0x{:x} active=0x{:x} focus=0x{:x} ({}) root=0x{:x}",
            self.foreground, self.active, self.focus, self.focus_class, self.focus_root
        )
    }
}

/// Куда вернуть клавиатуру.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FocusTarget {
    /// Главный webview — обычный случай.
    Main,
    /// Открытое поле ответа (HWND попапа): пользователь печатает там, и
    /// новый попап не имеет права уводить клавиатуру в портал.
    Reply(isize),
    /// Foreground украли у ЧУЖОЙ программы — вернуть его ей (клавиатуру в
    /// другое приложение без AttachThreadInput не поставить, а человека,
    /// работавшего в Word/Блокноте, тащить в портал нельзя).
    RestoreForeground(isize),
}

fn hwnd(value: isize) -> HWND {
    HWND(value as *mut std::ffi::c_void)
}

fn class_name(value: isize) -> String {
    if value == 0 {
        return String::new();
    }
    let mut buf = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd(value), &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

/// Снимок клавиатурного фокуса потока, которому принадлежит `main`.
pub(crate) fn snapshot(main: isize) -> Option<FocusSnapshot> {
    if main == 0 {
        return None;
    }
    let thread = unsafe { GetWindowThreadProcessId(hwnd(main), None) };
    if thread == 0 {
        return None;
    }
    let mut info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    unsafe { GetGUIThreadInfo(thread, &mut info) }.ok()?;
    let focus = info.hwndFocus.0 as isize;
    let focus_root = if focus == 0 {
        0
    } else {
        unsafe { GetAncestor(info.hwndFocus, GA_ROOT) }.0 as isize
    };
    Some(FocusSnapshot {
        foreground: unsafe { GetForegroundWindow() }.0 as isize,
        active: info.hwndActive.0 as isize,
        focus,
        focus_root,
        focus_class: class_name(focus),
    })
}

/// Куда возвращать клавиатуру (None — не трогать). Вся политика здесь, ОС
/// трогает только вызывающий код (юнит-тесты без окон).
///
/// `pre_theft` — foreground НЕПОСРЕДСТВЕННО перед кражей (`show()` снимает его
/// до показа). Это единственный достоверный признак «откуда украли»: флаг
/// `replying` означает лишь «поле ответа открыто», а человек мог уже уйти
/// кликом в портал — возврат в такое поле выдернул бы каретку из композера.
///
/// - пользователь ушёл в другое приложение (foreground не наш) — не трогаем;
/// - foreground наш: портал ИЛИ любой наш попап — показ попапа может увести
///   foreground, это не повод ничего не делать;
/// - фокус в портале — всё в порядке;
/// - фокус в ПОЛЕ ОТВЕТА — там печатают, не трогаем;
/// - фокус увели в другой попап: возвращаем туда, откуда украли — в поле
///   ответа, если украли из него, иначе в портал;
/// - фокус «потерялся» (0) — возвращаем: уничтожение окна с webview-ребёнком
///   оставляет очередь без фокуса (winit #4345);
/// - фокус в чужом окне / кража произошла у чужого приложения — не наше дело
///   (возврат к чужому окну требует AttachThreadInput, а тащить человека в
///   портал вместо его программы нельзя).
pub(crate) fn focus_target(
    foreground: isize,
    focus_root: isize,
    main: isize,
    popups: &[(isize, bool)],
    pre_theft: Option<isize>,
) -> Option<FocusTarget> {
    if foreground == 0 || focus_root == main {
        return None;
    }
    let ours = foreground == main || popups.iter().any(|(popup, _)| *popup == foreground);
    if !ours {
        return None;
    }
    let fallback = match pre_theft {
        // Украли из этого же приложения: из поля ответа — вернуть в него,
        // из обычного попапа — в портал.
        Some(previous) if previous == main => Some(FocusTarget::Main),
        Some(previous)
            if popups
                .iter()
                .any(|(popup, replying)| *popup == previous && *replying) =>
        {
            Some(FocusTarget::Reply(previous))
        }
        Some(previous) if popups.iter().any(|(popup, _)| *popup == previous) => {
            Some(FocusTarget::Main)
        }
        // Украли у чужой программы — возвращаем foreground ей.
        Some(previous) if previous != 0 => Some(FocusTarget::RestoreForeground(previous)),
        // Источник неизвестен (сторож) — только портал: гадать не о чем.
        _ => Some(FocusTarget::Main),
    };
    match popups.iter().find(|(popup, _)| *popup == focus_root) {
        // Фокус в поле ответа — норма (пользователь печатает).
        Some((_, true)) => None,
        Some((_, false)) => fallback,
        // Фокус потерян.
        None if focus_root == 0 => fallback,
        None => None,
    }
}

fn allow_reclaim() -> bool {
    let now = activity::monotonic_ms();
    let start = RECLAIM_START_MS.load(Ordering::Relaxed);
    if start == 0 || now.saturating_sub(start) > RECLAIM_WINDOW_MS {
        RECLAIM_START_MS.store(now.max(1), Ordering::Relaxed);
        RECLAIM_COUNT.store(0, Ordering::Relaxed);
        LIMIT_LOGGED.store(false, Ordering::Relaxed);
    }
    let count = RECLAIM_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    if count <= MAX_RECLAIMS {
        return true;
    }
    if !LIMIT_LOGGED.swap(true, Ordering::Relaxed) {
        log::error!(
            "фокус попапа: больше {MAX_RECLAIMS} возвратов за {RECLAIM_WINDOW_MS} мс — \
             возврат приостановлен (гонка фокуса, #709)"
        );
    }
    false
}

/// Поставить клавиатуру в окно и ПРОВЕРИТЬ результат по состоянию.
/// ТОЛЬКО с главного потока.
///
/// `SetFocus` возвращает NULL и при успехе, если прежний фокус был вне очереди
/// потока (кросс-процессный `Chrome_WidgetWin_1` — ровно наш случай), а
/// windows-rs заворачивает NULL в `Err` — судить по возврату нельзя, поэтому
/// смотрим `GetGUIThreadInfo` после вызова.
fn set_keyboard_focus(main: isize, target: isize) -> Result<(), String> {
    // Foreground мог уйти в попап: поднимаем и окно (наш процесс и так
    // foreground-процесс — ограничение SetForegroundWindow не мешает); когда
    // окно уже foreground, вызов no-op.
    unsafe {
        let _ = SetForegroundWindow(hwnd(target));
    }
    let _ = unsafe { SetFocus(Some(hwnd(target))) };
    match snapshot(main) {
        Some(snap) if snap.focus_root == target => Ok(()),
        Some(snap) => Err(format!(
            "фокус не встал: focus_root=0x{:x} ({})",
            snap.focus_root,
            class_name(snap.focus_root)
        )),
        None => Err("снимок фокуса недоступен".into()),
    }
}

/// Вернуть foreground чужой программе, у которой его украли. ТОЛЬКО с главного
/// потока. Своего фокуса туда не поставить (другая очередь ввода), поэтому
/// проверяем только сам foreground.
fn restore_foreground(main: isize, target: isize) -> Result<(), String> {
    unsafe {
        let _ = SetForegroundWindow(hwnd(target));
    }
    match snapshot(main) {
        Some(snap) if snap.foreground == target => Ok(()),
        Some(snap) => Err(format!(
            "foreground остался 0x{:x} ({})",
            snap.foreground,
            class_name(snap.foreground)
        )),
        None => Err("снимок фокуса недоступен".into()),
    }
}

/// Вернуть клавиатуру в главный webview. ТОЛЬКО с главного потока.
pub(crate) fn focus_main_now(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview_window("main") else {
        return false;
    };
    if !main.is_visible().unwrap_or(false) || main.is_minimized().unwrap_or(false) {
        return false;
    }
    let Ok(handle) = main.hwnd() else {
        return false;
    };
    let main_hwnd = handle.0 as isize;
    match set_keyboard_focus(main_hwnd, main_hwnd) {
        Ok(()) => true,
        Err(e) => {
            log::error!("фокус не вернулся в портал: {e}");
            false
        }
    }
}

/// Вернуть клавиатуру в портал (маршалит на главный поток).
pub(crate) fn focus_main(app: &AppHandle) {
    let app = app.clone();
    if let Err(e) = app.clone().run_on_main_thread(move || {
        focus_main_now(&app);
    }) {
        log::warn!("возврат фокуса не поставлен в очередь: {e}");
    }
}

/// Проверка и, если надо, возврат фокуса. ТОЛЬКО с главного потока.
/// `pre_theft` — foreground до кражи (см. `focus_target`); `None` — источник
/// неизвестен (сторож), возврат только в портал.
pub(crate) fn reclaim_now(app: &AppHandle, reason: &'static str, pre_theft: Option<isize>) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Ok(handle) = main.hwnd() else {
        return;
    };
    let main_hwnd = handle.0 as isize;
    let Some(snap) = snapshot(main_hwnd) else {
        return;
    };
    let targets = popups::focus_targets(app);
    let Some(target) = focus_target(
        snap.foreground,
        snap.focus_root,
        main_hwnd,
        &targets,
        pre_theft,
    ) else {
        return;
    };
    if !allow_reclaim() {
        return;
    }
    let (target_hwnd, where_to) = match target {
        FocusTarget::Main => (main_hwnd, "портал"),
        FocusTarget::Reply(popup) => (popup, "поле ответа"),
        FocusTarget::RestoreForeground(previous) => {
            // Клавиатуру в чужую программу без AttachThreadInput не поставить,
            // поэтому возвращаем только foreground. Отказ Windows — не ошибка
            // приложения (он может быть запрещён политикой) → warn, не error.
            return match restore_foreground(main_hwnd, previous) {
                Ok(()) => log::warn!(
                    "foreground увели у чужой программы: {} → возвращён ей ({reason})",
                    snap.log_line()
                ),
                Err(e) => log::warn!(
                    "foreground увели у чужой программы: {} — вернуть не удалось: {e} ({reason})",
                    snap.log_line()
                ),
            };
        }
    };
    match set_keyboard_focus(main_hwnd, target_hwnd) {
        Ok(()) => log::warn!(
            "фокус ушёл из портала: {} → возвращён в {where_to} ({reason})",
            snap.log_line()
        ),
        Err(e) => log::error!(
            "фокус ушёл из портала: {} — возврат не удался: {e} ({reason})",
            snap.log_line()
        ),
    }
}

/// Проверка фокуса с фонового потока (сторож, события создания окон).
pub(crate) fn reclaim(app: &AppHandle, reason: &'static str) {
    let app = app.clone();
    if let Err(e) = app.clone().run_on_main_thread(move || {
        reclaim_now(&app, reason, None);
    }) {
        log::warn!("проверка фокуса не поставлена в очередь: {e}");
    }
}

/// Сторож на 2 с после создания/показа попапа: кража фокуса асинхронна
/// (контроллер WebView2, первый кадр, навигация мини-UI) — одной проверки
/// в момент `show()` не хватает (#709).
pub(crate) fn arm_guard(app: &AppHandle, reason: &'static str) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("focus-guard".into())
        .spawn(move || {
            for _ in 0..GUARD_TICKS {
                std::thread::sleep(Duration::from_millis(GUARD_TICK_MS));
                reclaim(&app, reason);
            }
        });
    if let Err(e) = spawned {
        log::warn!("сторож фокуса не запущен: {e}");
    }
}

/// Одна строка на показ попапа: отрицательное доказательство («фокус был в
/// портале») нужно не меньше положительного — без него следующий разбор
/// снова останется догадкой. ТОЛЬКО с главного потока.
pub(crate) fn log_snapshot(app: &AppHandle, label: &str, stage: &str) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Ok(handle) = main.hwnd() else {
        return;
    };
    if let Some(snap) = snapshot(handle.0 as isize) {
        log::info!(
            "{label} ({stage}): main=0x{:x} {}",
            handle.0 as isize,
            snap.log_line()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: isize = 0x100;
    const POPUP: isize = 0x200;
    const REPLYING: isize = 0x300;
    const FOREIGN: isize = 0x400;

    fn popups() -> Vec<(isize, bool)> {
        vec![(POPUP, false), (REPLYING, true)]
    }

    fn idle() -> Vec<(isize, bool)> {
        vec![(POPUP, false)]
    }

    /// Политика возврата фокуса (#709): трогаем только СВОИ окна (портал или
    /// попап), чужое приложение не задеваем, фокус в поле ответа не уводим, а
    /// цель выбираем по состоянию ДО кражи — `replying` значит лишь «поле
    /// открыто» и не говорит, где человек печатает сейчас.
    #[test]
    fn возврат_только_из_своего_попапа_без_ответа() {
        // Фокус в попапе, foreground — портал, до кражи были в портале.
        assert_eq!(
            focus_target(MAIN, POPUP, MAIN, &idle(), Some(MAIN)),
            Some(FocusTarget::Main)
        );
        // Показ попапа увёл foreground в него же — тоже возвращаем в портал.
        assert_eq!(
            focus_target(POPUP, POPUP, MAIN, &idle(), Some(MAIN)),
            Some(FocusTarget::Main)
        );
        // Фокус в поле ответа — там печатают, не мешаем.
        assert_eq!(
            focus_target(REPLYING, REPLYING, MAIN, &popups(), Some(REPLYING)),
            None
        );
        // Украли из поля ответа A — возвращаем В ПОЛЕ, а не в портал.
        assert_eq!(
            focus_target(MAIN, POPUP, MAIN, &popups(), Some(REPLYING)),
            Some(FocusTarget::Reply(REPLYING))
        );
        assert_eq!(
            focus_target(POPUP, POPUP, MAIN, &popups(), Some(REPLYING)),
            Some(FocusTarget::Reply(REPLYING))
        );
        // РЕГРЕСС (валидация): поле ответа открыто, но человек уже кликнул в
        // портал и печатает там — новый попап не имеет права тащить его в
        // поле ответа. До кражи foreground был портал.
        assert_eq!(
            focus_target(POPUP, POPUP, MAIN, &popups(), Some(MAIN)),
            Some(FocusTarget::Main)
        );
        assert_eq!(
            focus_target(MAIN, POPUP, MAIN, &popups(), Some(MAIN)),
            Some(FocusTarget::Main)
        );
        // Источник неизвестен (сторож) — только в портал, без догадок.
        assert_eq!(
            focus_target(POPUP, POPUP, MAIN, &popups(), None),
            Some(FocusTarget::Main)
        );
        // Фокус в портале — всё в порядке (даже при открытом поле ответа).
        assert_eq!(focus_target(MAIN, MAIN, MAIN, &popups(), Some(MAIN)), None);
        // Пользователь в другом приложении — не трогаем.
        assert_eq!(
            focus_target(FOREIGN, FOREIGN, MAIN, &popups(), Some(FOREIGN)),
            None
        );
        // Фокус украли у чужой программы — возвращаем foreground ЕЙ, а не
        // тащим человека в портал (клавиатуру в чужое окно не поставить).
        assert_eq!(
            focus_target(POPUP, POPUP, MAIN, &popups(), Some(FOREIGN)),
            Some(FocusTarget::RestoreForeground(FOREIGN))
        );
        assert_eq!(
            focus_target(MAIN, POPUP, MAIN, &idle(), Some(FOREIGN)),
            Some(FocusTarget::RestoreForeground(FOREIGN))
        );
        // Нет foreground (локскрин/смена сессии) — не трогаем.
        assert_eq!(focus_target(0, 0, MAIN, &popups(), None), None);
        // Фокус потерян при нашем foreground — возвращаем (winit #4345).
        assert_eq!(
            focus_target(MAIN, 0, MAIN, &idle(), Some(MAIN)),
            Some(FocusTarget::Main)
        );
        assert_eq!(
            focus_target(POPUP, 0, MAIN, &idle(), Some(MAIN)),
            Some(FocusTarget::Main)
        );
        assert_eq!(
            focus_target(MAIN, 0, MAIN, &popups(), Some(REPLYING)),
            Some(FocusTarget::Reply(REPLYING))
        );
        assert_eq!(
            focus_target(MAIN, 0, MAIN, &popups(), Some(MAIN)),
            Some(FocusTarget::Main)
        );
        // Фокус в чужом окне — не наше дело.
        assert_eq!(
            focus_target(MAIN, FOREIGN, MAIN, &popups(), Some(MAIN)),
            None
        );
        // Живых попапов нет: возврат только для потерянного фокуса.
        assert_eq!(focus_target(MAIN, POPUP, MAIN, &[], Some(MAIN)), None);
        assert_eq!(
            focus_target(MAIN, 0, MAIN, &[], Some(MAIN)),
            Some(FocusTarget::Main)
        );
    }

    /// Лимит возвратов: защита от петли фокуса (tauri#15624 — наивный ремонт
    /// давал 140–200 Гц). После MAX_RECLAIMS в окне — отказ до истечения окна.
    #[test]
    fn лимит_возвратов_защищает_от_петли() {
        RECLAIM_START_MS.store(0, Ordering::Relaxed);
        RECLAIM_COUNT.store(0, Ordering::Relaxed);
        LIMIT_LOGGED.store(false, Ordering::Relaxed);
        for _ in 0..MAX_RECLAIMS {
            assert!(allow_reclaim(), "в пределах лимита возврат разрешён");
        }
        assert!(!allow_reclaim(), "сверх лимита — приостановка");
        assert!(!allow_reclaim(), "приостановка держится до конца окна");
    }
}
